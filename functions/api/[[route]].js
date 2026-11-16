import { handleApi, json } from "../../server/api.js";

export async function onRequest({ request, env }) {
  try {
    return await handleApi(request, env);
  } catch (error) {
    console.error(error);
    return json({ error: "Error interno. Inténtalo de nuevo." }, 500);
  }
}
