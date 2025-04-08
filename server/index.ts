import { parse } from "path";
import { CronJob } from "cron";
import winston from "winston";
import { readdir, rm, mkdir } from "node:fs/promises";

// 30 minutes
const EXPIRATION_TIME = 30 * 60 * 1000;
const FILES_FOLDER = "/usr/app/gltf2usdz/files";
const LOGS_FOLDER = "/usr/app/gltf2usdz/logs";
const FRONTEND_FOLDER = "../client/dist";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `[${info.timestamp}] ${info.level}: ${info.message}`,
    ),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      // 20 megabytes
      maxsize: 20_000_000,
      maxFiles: 5,
      filename: `${LOGS_FOLDER}/app.log`,
      format: winston.format.timestamp(),
    }),
  ],
});

const job = new CronJob("* * * * *", deleteExpiredFiles);

job.start();

mkdir(FILES_FOLDER, { recursive: true });

Bun.serve({
  port: 4000,
  maxRequestBodySize: 1024 * 1024 * 50, // 50MB
  async fetch(req) {
    const { pathname, searchParams } = new URL(req.url);

    if (pathname === "/api/convert") {
      try {
        const formdata = await req.formData();
        const file = formdata.get("file") as unknown as File;

        logger.info(`Converting file ${file.name}...`);

        if (
          !file ||
          !(file instanceof File) ||
          !(file.name.endsWith(".gltf") || file.name.endsWith(".glb"))
        ) {
          throw new Error("You must upload a glb/gltf file.");
        }

        const expires = Date.now() + EXPIRATION_TIME;
        const id = `${expires}_${crypto.randomUUID()}`;

        const filename = `${FILES_FOLDER}/${id}/${file.name}`;

        await Bun.write(filename, file);

        const name = convertFile(filename);

        return Response.json({ id, expires, name });
      } catch (error) {
        logger.error(error);
        return Response.json({ message: String(error) }, { status: 500 });
      }
    }

    if (pathname === "/api/download") {
      try {
        if (!searchParams.has("id") || !searchParams.has("name")) {
          return new Response("Bad request", { status: 400 });
        }

        const file = Bun.file(
          `${FILES_FOLDER}/${searchParams.get("id")}/${searchParams.get("name")}`,
        );

        if (!(await file.exists())) {
          throw new Error();
        }

        return new Response(file);
      } catch (error) {
        const message =
          "Failed to download the file. Your file maybe is expired.";
        logger.error(message);
        return Response.json({ message }, { status: 500 });
      }
    }

    if (pathname === "/") {
      return new Response(Bun.file(`${FRONTEND_FOLDER}/index.html`));
    }

    try {
      const file = Bun.file(FRONTEND_FOLDER + pathname);

      if (!(await file.exists())) {
        throw new Error();
      }

      return new Response(file);
    } catch (error) {
      return new Response("Not Found", { status: 404 });
    }
  },
});

logger.info("gltf2usdz is running on port 4000");

function convertFile(filepath: string) {
  const { ext, name } = parse(filepath);

  const output = filepath.replace(ext, ".usdz");

  const { stderr } = Bun.spawnSync([`usd_from_gltf`, filepath, output]);

  const stderrString = stderr.toString();
  
  if (stderrString) {
    logger.warn(stderrString);
  }

  const outputFile = Bun.file(output);
  if (!outputFile.exists()) {
    throw new Error("Failed to create USDZ file");
  }

  logger.info("File converted successfully");

  return `${name}.usdz`;
}

async function deleteExpiredFiles() {
  logger.info("Cleaning expired files");
  const files = await readdir(FILES_FOLDER);
  const now = Date.now();

  for (const file of files) {
    const timestamp = Number(file.substring(0, file.indexOf("_")));

    if (now > timestamp) {
      rm(`${FILES_FOLDER}/${file}`, { recursive: true });
      logger.info(`Deleting ${FILES_FOLDER}/${file}`);
    }
  }
  logger.info("Ended cleaning expired files");
}
