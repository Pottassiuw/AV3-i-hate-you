import { Type } from "@sinclair/typebox";
import { categories } from "../analytics/service.js";
export const CategorySchema = Type.Union(
  categories.map((c) => Type.Literal(c)),
);
export const ErrorSchema = Type.Object({
  erro: Type.String(),
  mensagem: Type.String(),
});
export const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 422, 429, 500].map((code) => [code, ErrorSchema]),
);
export const JobSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  status: Type.String({
    examples: ["PENDENTE", "EXECUTANDO", "CONCLUIDO", "FALHOU"],
  }),
  tentativas: Type.Integer(),
  criadaEm: Type.String({ format: "date-time" }),
  concluidaEm: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
  erro: Type.Union([Type.String(), Type.Null()]),
  relatorioId: Type.Union([Type.String(), Type.Null()]),
});
export const ReportSchema = Type.Object({
  id: Type.String({ format: "uuid" }),
  organizacaoId: Type.String({ format: "uuid" }),
  categoria: Type.String({ enum: [...categories] }),
  modeloVersao: Type.String(),
  criadoEm: Type.String({ format: "date-time" }),
  resultado: Type.Unknown({
    description:
      "Métricas da categoria, parâmetros, amostras, limitações e previsões; estrutura descrita em docs/relatorio-tecnico.md.",
    examples: [
      {
        categoria: "eficiencia",
        equipamentos: 2,
        eficiencia: { amostras: 1, media: 24, lotesAbertos: 0 },
      },
    ],
  }),
});
