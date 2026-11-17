import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, closeSync, constants, openSync, readSync, unlinkSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, delimiter, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { useMemo, useRef, useState } from "react";
import {
  Action,
  ActionPanel,
  Color,
  Grid,
  Icon,
  Keyboard,
  LaunchProps,
  getPreferenceValues,
  openExtensionPreferences,
} from "@raycast/api";
import { getProgressIcon, usePromise } from "@raycast/utils";

const LIMIT = "50";

const TICK = 50;
const DELAY = 1000;
const LONG = 8000;

const NAME = "scry-raycast";

const INSTALL_DIRS = [
  join(homedir(), ".local/bin"),
  join(homedir(), ".cargo/bin"),
  join(homedir(), ".nix-profile/bin"),
  `/etc/profiles/per-user/${userInfo().username}/bin`,
  "/run/current-system/sw/bin",
];

type Mode = "query" | "text";

export default function SearchImages(props: LaunchProps<{ arguments: Arguments.SearchImages }>) {
  const { folder, scryPath } = getPreferenceValues<Preferences>();
  const scry = useMemo(() => scryPath || findScry(), [scryPath]);
  const [query, setQuery] = useState(props.arguments.query ?? "");
  const [mode, setMode] = useState<Mode>("query");
  const text = query.trim();
  const options = mode === "query" ? [`--query=${text}`] : [`--text=${literal(text)}`, "--sort", "date"];
  const search = useSearch(scry, folder, text === "" ? undefined : options);

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

  return (
    <Grid
      isLoading={search.isLoading}
      filtering={false}
      throttle
      searchText={query}
      onSearchTextChange={setQuery}
      searchBarPlaceholder={mode === "query" ? "What the image shows" : "Text in the image"}
      searchBarAccessory={
        <Grid.Dropdown tooltip="Search By" storeValue onChange={(value) => setMode(value as Mode)}>
          <Grid.Dropdown.Item title="Meaning" value="query" />
          <Grid.Dropdown.Item title="Text in Images" value="text" />
        </Grid.Dropdown>
      }
    >
      {text !== "" ? (
        <Matches search={search} scry={scry} folder={folder} />
      ) : mode === "query" ? (
        <Grid.EmptyView
          icon={Icon.MagnifyingGlass}
          title="Describe the image"
          description={`In any language. scry searches ${folder}`}
        />
      ) : (
        <Grid.EmptyView
          icon={Icon.Text}
          title="Type the text in the image"
          description={`scry reads the images in ${folder}`}
        />
      )}
    </Grid>
  );
}

function Similar({ scry, folder, path }: { scry: string; folder: string; path: string }) {
  const search = useSearch(scry, folder, [`--like=${path}`]);
  return (
    <Grid isLoading={search.isLoading} navigationTitle={`Like ${basename(path)}`} searchBarPlaceholder="Filter by name">
      <Matches search={search} scry={scry} folder={folder} />
    </Grid>
  );
}

type Search = { isLoading: boolean; status: Status | undefined; paths: string[] };

function useSearch(scry: string | undefined, folder: string, options: string[] | undefined): Search {
  const abortable = useRef<AbortController>(null);
  const [progress, setProgress] = useState<Status>();
  const { isLoading, data } = usePromise(
    (scry: string, folder: string, options: string[]) =>
      search(scry, folder, options, setProgress, abortable.current?.signal),
    [scry ?? "", folder, options ?? []],
    {
      abortable,
      execute: scry !== undefined && options !== undefined,
      failureToastOptions: { title: "scry failed" },
    },
  );
  const status = isLoading ? progress : undefined;
  return { isLoading, status, paths: options === undefined || status ? [] : (data ?? []) };
}

function Matches({ search, scry, folder }: { search: Search; scry: string; folder: string }) {
  return (
    <>
      {search.status ? (
        <Grid.EmptyView {...progressView(search.status)} />
      ) : search.isLoading ? (
        <Grid.EmptyView icon={Icon.Hourglass} title="Searching" />
      ) : (
        <Grid.EmptyView icon={Icon.Image} title="No image matches" />
      )}
      {search.paths.map((path) => (
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
              <Action.Push
                title="Find Similar"
                icon={Icon.MagnifyingGlass}
                shortcut={{ modifiers: ["cmd"], key: "l" }}
                target={<Similar scry={scry} folder={folder} path={path} />}
              />
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
    </>
  );
}

async function search(
  scry: string,
  folder: string,
  options: string[],
  show: (status: Status | undefined) => void,
  signal?: AbortSignal,
): Promise<string[]> {
  const args = ["--json", ...options, "--limit", LIMIT, "--", folder];
  show(undefined);
  await stopEarlierSearches();
  signal?.throwIfAborted();
  const started = Date.now();
  return run(scry, args, (event) => {
    const loading = event.type === "progress" && event.stage === "load";
    const elapsed = Date.now() - started;
    if (!signal?.aborted && elapsed >= DELAY && !loading) show({ event, elapsed });
  });
}

function literal(text: string): string {
  return text.replace(/[\\.+*?()|[\]{}^$#&\-~]/g, "\\$&");
}

type Status = { event: Download | Progress; elapsed: number };

function progressView({ event, elapsed }: Status): Grid.EmptyView.Props {
  const icon = getProgressIcon(event.total > 0 ? event.done / event.total : 0, Color.Purple);
  const note = elapsed >= LONG ? ". You can close Raycast, scry keeps going in the background" : "";
  if (event.type === "download") {
    const description = `${event.label}, ${megabytes(event.done)} of ${megabytes(event.total)} MB${note}`;
    return { icon, title: "Downloading", description };
  }
  const total = `${event.total.toLocaleString()}${event.walking ? "+" : ""}`;
  return { icon, title: "Indexing", description: `${event.done.toLocaleString()} of ${total} images${note}` };
}

function megabytes(bytes: number): string {
  return Math.round(bytes / 1e6).toLocaleString();
}

function stopEarlierSearches(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/pkill", ["-U", String(userInfo().uid), "-f", `^${NAME} `], (error) => {
      if (error && error.code !== 1) reject(error);
      else resolve();
    });
  });
}

type Download = { type: "download"; label: string; done: number; total: number };
type Progress = { type: "progress"; stage: string; done: number; total: number; walking: boolean };
type Event =
  Download | Progress | { type: "match"; path: string } | { type: "end" } | { type: "error"; message: string };

function run(scry: string, args: string[], progress: (event: Download | Progress) => void): Promise<string[]> {
  const path = join(tmpdir(), `${NAME}-${randomUUID()}`);
  const out = openSync(path, "wx", 0o600);
  const stdout = openSync(path, "r");
  unlinkSync(path);
  return new Promise((resolve, reject) => {
    const child = spawn(scry, args, { argv0: NAME, detached: true, stdio: ["ignore", out, "pipe"] });
    closeSync(out);
    const paths: string[] = [];
    let ended = false;
    let failure: string | undefined;
    const read = lines(stdout, (line) => {
      const event = JSON.parse(line) as Event;
      if (event.type === "download" || event.type === "progress") progress(event);
      else if (event.type === "match") paths.push(event.path);
      else if (event.type === "end") ended = true;
      else if (event.type === "error") failure = event.message;
    });
    const timer = setInterval(read, TICK);
    let stderr = "";
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearInterval(timer);
      read();
      closeSync(stdout);
      if (ended) {
        resolve(paths);
      } else if (failure !== undefined) {
        reject(new Error(failure));
      } else if (stderr.includes("unexpected argument '--json'")) {
        reject(new Error("Update scry to 0.6.0 or newer"));
      } else {
        reject(new Error(stderr.trim() || `scry exited with ${code ?? signal}`));
      }
    });
  });
}

function lines(fd: number, line: (text: string) => void): () => void {
  const buffer = Buffer.alloc(64 * 1024);
  const decoder = new StringDecoder("utf8");
  let rest = "";
  return () => {
    let n;
    while ((n = readSync(fd, buffer)) > 0) rest += decoder.write(buffer.subarray(0, n));
    const whole = rest.split("\n");
    rest = whole.pop()!;
    whole.forEach(line);
  };
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
