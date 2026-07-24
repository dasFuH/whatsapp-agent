create extension if not exists vector;

create table projekte (
  id            bigint generated always as identity primary key,
  wa_message_id text unique,
  author_jid    text,
  author_name   text,
  created_at    timestamptz default now(),
  titel         text,
  summary       text,
  tags          text[],
  kategorie     text,
  status        text default 'frei',
  claimed_by    text,
  raw_md        text,
  md_url        text,
  embedding     vector(1024),
  fts tsvector generated always as (
    to_tsvector('german',
      coalesce(titel,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_md,''))
  ) stored
);

create index on projekte using hnsw (embedding vector_cosine_ops);
create index on projekte using gin  (fts);

alter table public.projekte enable row level security;

revoke all on table public.projekte from anon, authenticated;
revoke all on sequence public.projekte_id_seq from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.projekte to service_role;
grant usage, select on sequence public.projekte_id_seq to service_role;

create or replace function suche_projekte(
  query_embedding vector(1024),
  query_text      text,
  treffer         int default 5
)
returns setof projekte language sql stable as $$
  select *
  from projekte
  where status <> 'erledigt'
  order by
    (embedding <=> query_embedding)
    - 0.15 * ts_rank(fts, plainto_tsquery('german', query_text))
  limit treffer;
$$;

revoke execute on function public.suche_projekte(vector, text, integer)
  from public, anon, authenticated;
grant execute on function public.suche_projekte(vector, text, integer)
  to service_role;
