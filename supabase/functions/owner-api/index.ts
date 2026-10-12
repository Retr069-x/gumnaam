import { createOwnerHandler } from "../_shared/owner.mjs";

Deno.serve(createOwnerHandler(Deno.env.toObject()));
