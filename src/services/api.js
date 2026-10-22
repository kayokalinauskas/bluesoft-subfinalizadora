import { CONFIG } from "../config.js";
import { MappingApi } from "./mappingApi.js";

export const ApiService = new MappingApi(CONFIG.PROXY_URL);
