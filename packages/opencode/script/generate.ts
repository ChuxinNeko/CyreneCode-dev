import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

// Model registry is intentionally NOT fetched from models.dev: this project
// lets users add third-party providers/models manually in the app settings.
// To inject an offline model snapshot instead, set MODELS_DEV_API_JSON to the
// path of a local models.dev api.json file.
export const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : "{}"
console.log("Loaded model registry")
