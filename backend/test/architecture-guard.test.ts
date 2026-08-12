import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

type SourceLayer =
  | "routes"
  | "middleware"
  | "services"
  | "lib"
  | "repositories"
  | "mappers"
  | "schemas"
  | "types";

type SourceFile = {
  absolutePath: string;
  projectPath: string;
  layer: SourceLayer;
  source: string;
};

type SourceImport = {
  sourceFile: SourceFile;
  specifier: string;
  targetFile: SourceFile | null;
};

const backendRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(backendRoot, "src");
const sourceLayers: SourceLayer[] = [
  "routes",
  "middleware",
  "services",
  "lib",
  "repositories",
  "mappers",
  "schemas",
  "types",
];

const routeServiceMap = new Map<string, string>([
  ["src/routes/admin.routes.ts", "src/services/admin.service.ts"],
  ["src/routes/auth.routes.ts", "src/services/auth.service.ts"],
  ["src/routes/hooks.routes.ts", "src/services/hooks.service.ts"],
  ["src/routes/http-streams.routes.ts", "src/services/http-stream.service.ts"],
  ["src/routes/live-streams.routes.ts", "src/services/live-streams.service.ts"],
  ["src/routes/recordings.routes.ts", "src/services/recordings.service.ts"],
  ["src/routes/repositories.routes.ts", "src/services/repositories.service.ts"],
  ["src/routes/streams.routes.ts", "src/services/stream.service.ts"],
  ["src/routes/videos.route.ts", "src/services/videos.service.ts"],
]);

const importPattern =
  /\b(?:import|export)\s+(?:type\s+)?(?:(?:[\s\S]*?)\s+from\s+)?["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const toProjectPath = (absolutePath: string) =>
  path.relative(backendRoot, absolutePath).split(path.sep).join("/");

const isSourceLayer = (value: string): value is SourceLayer =>
  sourceLayers.includes(value as SourceLayer);

const collectSourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(entryPath);
      }

      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".d.ts")) {
        return [];
      }

      return [entryPath];
    }),
  );

  return files.flat();
};

const loadSourceFiles = async (): Promise<SourceFile[]> => {
  const pathsByLayer = await Promise.all(
    sourceLayers.map(async (layer) => {
      const directory = path.join(srcRoot, layer);
      const filePaths = await collectSourceFiles(directory);
      return filePaths.map((filePath) => ({ layer, filePath }));
    }),
  );

  return Promise.all(
    pathsByLayer.flat().map(async ({ layer, filePath }) => ({
      absolutePath: filePath,
      projectPath: toProjectPath(filePath),
      layer,
      source: await fs.readFile(filePath, "utf8"),
    })),
  );
};

const resolveTargetFile = (
  sourceFile: SourceFile,
  specifier: string,
  filesByAbsolutePath: Map<string, SourceFile>,
): SourceFile | null => {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const basePath = path.resolve(path.dirname(sourceFile.absolutePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    path.join(basePath, "index.ts"),
  ];

  for (const candidate of candidates) {
    const targetFile = filesByAbsolutePath.get(candidate);
    if (targetFile) {
      return targetFile;
    }
  }

  return null;
};

const collectImports = (files: SourceFile[]): SourceImport[] => {
  const filesByAbsolutePath = new Map(files.map((file) => [file.absolutePath, file]));
  const imports: SourceImport[] = [];

  for (const sourceFile of files) {
    importPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(sourceFile.source))) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) {
        continue;
      }

      imports.push({
        sourceFile,
        specifier,
        targetFile: resolveTargetFile(sourceFile, specifier, filesByAbsolutePath),
      });
    }
  }

  return imports;
};

const formatViolations = (violations: string[]) => violations.join("\n");

test("routes directly call only their matching route service", async () => {
  const files = await loadSourceFiles();
  const imports = collectImports(files);
  const routeFiles = files.filter((file) => file.layer === "routes");
  const missingRoutes = routeFiles
    .map((file) => file.projectPath)
    .filter((projectPath) => !routeServiceMap.has(projectPath));

  assert.deepEqual(missingRoutes, [], `Route service map is missing:\n${formatViolations(missingRoutes)}`);

  const violations = routeFiles.flatMap((routeFile) => {
    const expectedService = routeServiceMap.get(routeFile.projectPath);
    const importedServices = imports
      .filter((sourceImport) => sourceImport.sourceFile === routeFile && sourceImport.targetFile?.layer === "services")
      .map((sourceImport) => sourceImport.targetFile?.projectPath)
      .filter((targetPath): targetPath is string => Boolean(targetPath));

    if (importedServices.length === 1 && importedServices[0] === expectedService) {
      return [];
    }

    return [
      `${routeFile.projectPath} should import ${expectedService}, found ${importedServices.join(", ") || "none"}`,
    ];
  });

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("routes and services do not import Prisma infrastructure directly", async () => {
  const files = await loadSourceFiles();
  const imports = collectImports(files);
  const violations = imports
    .filter((sourceImport) => sourceImport.sourceFile.layer === "routes" || sourceImport.sourceFile.layer === "services")
    .filter((sourceImport) => sourceImport.targetFile?.projectPath === "src/lib/infra/prisma.ts")
    .map((sourceImport) => `${sourceImport.sourceFile.projectPath} imports ${sourceImport.specifier}`);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("lib components do not import Prisma infrastructure directly", async () => {
  const files = await loadSourceFiles();
  const imports = collectImports(files);
  const violations = imports
    .filter((sourceImport) => sourceImport.sourceFile.layer === "lib")
    .filter((sourceImport) => sourceImport.targetFile?.projectPath === "src/lib/infra/prisma.ts")
    .map((sourceImport) => `${sourceImport.sourceFile.projectPath} imports ${sourceImport.specifier}`);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("support layers do not import route-facing layers", async () => {
  const files = await loadSourceFiles();
  const imports = collectImports(files);
  const lowerLayers = new Set<SourceLayer>(["lib", "repositories", "mappers", "schemas", "types"]);
  const routeFacingLayers = new Set<SourceLayer>(["routes", "middleware", "services"]);
  const violations = imports
    .filter((sourceImport) => lowerLayers.has(sourceImport.sourceFile.layer))
    .filter((sourceImport) => sourceImport.targetFile && routeFacingLayers.has(sourceImport.targetFile.layer))
    .map(
      (sourceImport) =>
        `${sourceImport.sourceFile.projectPath} imports ${sourceImport.targetFile?.projectPath ?? sourceImport.specifier}`,
    );

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("mappers and DTO types do not import persistence files", async () => {
  const files = await loadSourceFiles();
  const imports = collectImports(files);
  const presentationLayers = new Set<SourceLayer>(["mappers", "types"]);
  const violations = imports
    .filter((sourceImport) => presentationLayers.has(sourceImport.sourceFile.layer))
    .filter((sourceImport) => sourceImport.targetFile?.layer === "repositories")
    .map((sourceImport) => `${sourceImport.sourceFile.projectPath} imports ${sourceImport.targetFile?.projectPath}`);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("schema files keep DTO aliases out of runtime validation modules", async () => {
  const files = await loadSourceFiles();
  const violations = files
    .filter((file) => file.layer === "schemas")
    .filter((file) => /\bexport\s+(?:type|interface)\b/.test(file.source))
    .map((file) => file.projectPath);

  assert.deepEqual(violations, [], formatViolations(violations));
});

test("video semantic metadata cascades with its parent video", async () => {
  const schema = await fs.readFile(path.join(backendRoot, "prisma", "schema.prisma"), "utf8");
  const semanticMetadataModel = schema.match(/model\s+VideoSemanticMetadata\s+\{[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(
    semanticMetadataModel,
    /\bvideo\s+Videos\s+@relation\(\s*fields:\s*\[videoId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\s*\)/,
  );
});
