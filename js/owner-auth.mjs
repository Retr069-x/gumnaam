export function createOwnerAuth(config, fetcher = fetch) {
  let session = null;
  let refreshing = null;
  let generation = 0;
  const validToken = (token) => typeof token === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
  function adopt(data, expected = generation) {
    if (expected !== generation) throw new Error("Session ended.");
    if (!validToken(data.access_token) || typeof data.refresh_token !== "string" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error("The sign-in response could not be verified.");
    session = { access_token: data.access_token, refresh_token: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000, user: data.user || session?.user };
    return session.user;
  }
  async function request(path, options = {}, token = "") {
    const response = await fetcher(`${config.projectUrl}/auth/v1${path}`, {
      ...options, signal: AbortSignal.timeout(15000), cache: "no-store",
      headers: { apikey: config.publishableKey, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
    if (!response.ok) {
      const error = new Error(response.status === 429 ? "Too many sign-in attempts. Wait before trying again." : path.startsWith("/token?grant_type=password") ? "Sign-in failed. Check your email and password." : "Authentication failed. Check your code or sign in again.");
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }
  async function token() {
    if (!session) throw new Error("Sign in to continue.");
    if (session.expiresAt - Date.now() > 60000) return session.access_token;
    if (!refreshing) {
      const expected = generation;
      const pending = request("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: session.refresh_token }) })
        .then((data) => { if (!session) throw new Error("Session ended."); adopt(data, expected); return session.access_token; })
        .catch((error) => { if (expected === generation) session = null; throw error; }).finally(() => { if (refreshing === pending) refreshing = null; });
      refreshing = pending;
    }
    return refreshing;
  }
  async function factors() {
    const user = await request("/user", {}, await token());
    if (session) session.user = user;
    return Array.isArray(user.factors) ? user.factors : [];
  }
  async function verify(factorId, code) {
    if (!/^[a-f0-9-]{36}$/i.test(factorId) || !/^\d{6}$/.test(code)) throw new Error("Enter the six-digit authenticator code.");
    const expected = generation;
    const access = await token();
    if (expected !== generation) throw new Error("Session ended.");
    const challenge = await request(`/factors/${factorId}/challenge`, { method: "POST", body: "{}" }, access);
    if (expected !== generation) throw new Error("Session ended.");
    adopt(await request(`/factors/${factorId}/verify`, { method: "POST", body: JSON.stringify({ challenge_id: challenge.id, code }) }, access), expected);
  }
  return {
    async signIn(email, password) {
      session = null;
      const expected = ++generation;
      if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || "")) throw new Error("The owner sign-in public key is not configured.");
      adopt(await request("/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }), expected);
      const enrolled = await factors();
      if (expected !== generation) throw new Error("Session ended.");
      return enrolled.find((factor) => factor.factor_type === "totp" && factor.status === "verified") || null;
    },
    token, factors, verify,
    async enroll() {
      if ((await factors()).some((factor) => factor.status === "verified")) throw new Error("An authenticator is already enabled.");
      return request("/factors", { method: "POST", body: JSON.stringify({ factor_type: "totp", friendly_name: "Gumnaam owner", issuer: "Gumnaam" }) }, await token());
    },
    async signOut() {
      const access = session?.access_token;
      generation++;
      session = null;
      refreshing = null;
      if (access) { try { await request("/logout?scope=local", { method: "POST" }, access); } catch {} }
    },
    clear() { generation++; session = null; refreshing = null; }
  };
}
