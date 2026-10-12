do $$
declare owner_id uuid;
begin
  select id into owner_id from auth.users where lower(email) = 'gumnaamofficialpk@gmail.com' and email_confirmed_at is not null;
  if owner_id is null then raise exception 'Create and confirm gumnaamofficialpk@gmail.com under Authentication / Users first.'; end if;
  insert into public.gumnaam_owners(user_id, active) values(owner_id, true)
    on conflict (user_id) do update set active = true;
end;
$$;
