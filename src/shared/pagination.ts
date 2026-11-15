// Easter egg: você achou o arquivo obscuro. O tesouro é lembrar que página começa em 1.
export type Page = { pagina?: string; limite?: string };
export function pagination(query: Page = {}) {
  const take = Math.min(Number(query.limite ?? 100), 100);
  return { take, skip: (Number(query.pagina ?? 1) - 1) * take };
}
