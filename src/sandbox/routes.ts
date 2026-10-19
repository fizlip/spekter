import { z } from "zod";
import { assertBoxId, type BoxRegistry } from "./boxes";
import { json, parseBody, type Route } from "./server";

const createBody = z.object({
  name: z.string().optional(),
  ttlSeconds: z.number().int().positive().optional(),
});

export function boxRoutes(boxes: BoxRegistry): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/boxes$/,
      handle: async (request) => json(await boxes.create(await parseBody(createBody, request)), 201),
    },
    { method: "GET", pattern: /^\/boxes$/, handle: async () => json({ boxes: boxes.list() }) },
    { method: "GET", pattern: /^\/boxes\/([^/]+)$/, handle: async (_request, [id]) => json(boxes.get(assertBoxId(id))) },
    {
      method: "DELETE",
      pattern: /^\/boxes\/([^/]+)$/,
      handle: async (_request, [id]) => {
        await boxes.destroy(assertBoxId(id));
        return json({ id, destroyed: true });
      },
    },
  ];
}
