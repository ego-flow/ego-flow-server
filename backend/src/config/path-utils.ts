import os from "os";
import path from "path";

const DEFAULT_CONFIG_FILE_NAME = "config.json";

const getProjectRootDir = () => path.resolve(__dirname, "../../..");

export const getConfiguredHomeDirectory = () => {
  const configured = process.env.HOST_HOME?.trim() || process.env.HOME?.trim();
  return configured || os.homedir();
};

export const expandHomePath = (value: string, homeDirectory = getConfiguredHomeDirectory()) => {
  if (value === "~") {
    return homeDirectory;
  }

  if (value.startsWith("~/")) {
    return path.join(homeDirectory, value.slice(2));
  }

  return value;
};

export const normalizeTargetDirectory = (value: string, homeDirectory = getConfiguredHomeDirectory()) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("TARGET_DIRECTORY cannot be blank.");
  }

  const expanded = expandHomePath(trimmed, homeDirectory);
  if (!path.isAbsolute(expanded)) {
    throw new Error("TARGET_DIRECTORY must be an absolute path or use ~/... shorthand.");
  }

  return path.normalize(expanded);
};

export const resolveConfiguredPath = (value: string | undefined, fallbackName = DEFAULT_CONFIG_FILE_NAME) => {
  if (!value) {
    return path.join(getProjectRootDir(), fallbackName);
  }

  return path.isAbsolute(value) ? value : path.resolve(getProjectRootDir(), value);
};
