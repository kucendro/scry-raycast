import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { useMemo, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Grid,
  Icon,
  Keyboard,
  LaunchProps,
  Toast,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";

const LIMIT = "50";

// Where the install methods in scry's README put the binary. Raycast does not load the shell's PATH.
const INSTALL_DIRS = [
  join(homedir(), ".local/bin"),
  join(homedir(), ".cargo/bin"),
  join(homedir(), ".nix-profile/bin"),
  `/etc/profiles/per-user/${userInfo().username}/bin`,
  "/run/current-system/sw/bin",
];

export default function SearchImages(props: LaunchProps<{ arguments: Arguments.SearchImages }>) {
  const { folder, scryPath } = getPreferenceValues<Preferences>();
  const scry = useMemo(() => scryPath || findScry(), [scryPath]);
  const [query, setQuery] = useState(props.arguments.query ?? "");
  const text = query.trim();

  // usePromise aborts the previous search when the text changes, which kills its scry.
  const abortable = useRef<AbortController>(null);
  const { isLoading, data } = usePromise(
    (scry: string, text: string, folder: string) => search(scry, text, folder, abortable.current?.signal),
    [scry ?? "", text, folder],
    {
      abortable,
      execute: scry !== undefined && text !== "",
      failureToastOptions: { title: "scry failed" },
    },
  );

  if (scry === undefined) {
    return (
      <Grid>
        <Grid.EmptyView
          icon={Icon.Warning}
          title="scry is not installed"
          description="Install scry, or set the path of the scry binary in the extension preferences"
          actions={
            <ActionPanel>
              <Action.OpenInBrowser
                title="Open Install Instructions"
                url="https://github.com/JirkaKlimes/scry#install"
              />
              <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      </Grid>
    );
  }

  const paths = text === "" ? [] : (data ?? []);
  return (
    <Grid
      isLoading={isLoading}
      filtering={false}
      throttle
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder="What the image shows"
    >
      {text === "" ? (
        <Grid.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Describe the image"
          description={`In any language. scry searches ${folder}`}
        />
      ) : isLoading ? (
        <Grid.EmptyView
          icon={Icon.Hourglass}
          title="Searching"
          description="The first search in a folder downloads the model and reads every image, which can take minutes"
        />
      ) : (
        <Grid.EmptyView icon={Icon.Image} title="No image matches" />
      )}
      {paths.map((path) => (
        <Grid.Item
          key={path}
          content={{ source: path }}
          title={basename(path)}
          quickLook={{ path }}
          actions={
            <ActionPanel>
              <Action.Open title="Open" target={path} />
              <Action.ShowInFinder path={path} />
              <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
              <Action.CopyToClipboard
                title="Copy Image"
                content={{ file: path }}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action.CopyToClipboard title="Copy Path" content={path} shortcut={Keyboard.Shortcut.Common.CopyPath} />
            </ActionPanel>
          }
        />
      ))}
    </Grid>
  );
}

// Shows the progress of a search that reads new images or downloads a model.
async function search(scry: string, text: string, folder: string, signal?: AbortSignal): Promise<string[]> {
  const args = [`--query=${text}`, "--progress", "--null", "--limit", LIMIT, "--", folder];
  let toast: Toast | undefined;
  try {
    return await run(scry, args, signal, (line) => {
      const message = line.replace(/^scry: /, "");
      if (toast) {
        toast.message = message;
      } else {
        toast = new Toast({ style: Toast.Style.Animated, title: "Searching", message });
        void toast.show();
      }
    });
  } finally {
    void toast?.hide();
  }
}

// The paths that scry prints. Before the first path, each line on stderr is progress and goes to
// `progress`. After the paths come notes, like the number of skipped files.
function run(
  scry: string,
  args: string[],
  signal: AbortSignal | undefined,
  progress: (line: string) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(scry, args, { signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const stderr: string[] = [];
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    createInterface({ input: child.stderr }).on("line", (line) => {
      stderr.push(line);
      if (stdout === "") progress(line);
    });
    // An abort ends here, as an AbortError that usePromise does not show.
    child.on("error", reject);
    child.on("close", (code, killed) => {
      // scry exits with 1 when no image matches.
      if (code === 0 || code === 1) {
        resolve(stdout.split("\0").filter(Boolean));
      } else if (stderr.some((line) => line.includes("unexpected argument '--progress'"))) {
        reject(new Error("Update scry: this version has no --progress"));
      } else {
        reject(new Error(stderr.join("\n").trim() || `scry exited with ${code ?? killed}`));
      }
    });
  });
}

function findScry(): string | undefined {
  const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...INSTALL_DIRS];
  return dirs.map((dir) => join(dir, "scry")).find(isExecutable);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
