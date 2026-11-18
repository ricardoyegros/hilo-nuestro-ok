import { json } from "../../_lib/util.js";

export function onRequestGet({ data }) {
  return json({ email: data.admin });
}
