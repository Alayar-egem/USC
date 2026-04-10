// frontend/src/config.ts
const raw = import.meta.env.VITE_API_BASE as string | undefined;

// ✅ В деве лучше использовать proxy: "/api"
// ✅ Если захочешь — можешь переопределить через .env (например VITE_API_BASE="http://server/api")
const normalizedRaw = raw?.trim() ?? "";
const base = normalizedRaw && normalizedRaw !== "/" ? normalizedRaw : "/api";
export const API_BASE = base.replace(/\/+$/, "");
