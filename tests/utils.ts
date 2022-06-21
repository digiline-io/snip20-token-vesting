import {spawn} from "child_process";
import * as fs from "fs";
import * as path from "path";

export function executeShell(command: string, args: string[] = [], cwd: string = process.cwd()): Promise<[string, number]> {
  const exec = spawn(command, args, {cwd});

  return new Promise((resolve, reject) => {
    let out = '';
    exec.stdout.on('data', (data) => {
      out += data;
      process.stdout.write(data.toString())
    });

    exec.stderr.on('data', (data) => {
      out += data;
      process.stderr.write(data.toString())
    });

    exec.on('close', (code) => {
      resolve([
        out, code
      ])
    });
  });
}

async function* getFilesInRustProject(dir: string): AsyncIterable<string> {
  const dirents = await fs.promises.readdir(dir, {withFileTypes: true});
  for (const dirent of dirents) {
    const res = path.resolve(dir, dirent.name);
    if (dirent.isDirectory() && !res.endsWith("target"))
      yield* getFilesInRustProject(res);
    else if (res.endsWith(".rs"))
      yield res;
  }
}

export async function getLastModifiedInRustProject(directory: string): Promise<number> {
  let lastModified = 0;
  for await (const f of getFilesInRustProject(directory)) {
    const stat = await fs.promises.stat(f);
    if (stat.mtimeMs > lastModified)
      lastModified = stat.mtimeMs;
  }
  return lastModified;
}
