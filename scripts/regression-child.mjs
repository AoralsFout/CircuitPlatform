import { app } from "electron";
import { pathToFileURL } from "node:url";

// 每个场景独享配置目录，避免读写开发者的最近项目记录；个别夹具仍可设置更细的目录。
app.setPath("userData", process.env.CIRCUIT_REGRESSION_USER_DATA);
await import(pathToFileURL(process.argv[2]).href);
