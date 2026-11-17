import { basename } from "node:path";
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
import { Download, Progress, findScry, literal, run, stopEarlierSearches } from "./scry";

const LIMIT = "50";

const DELAY = 1000;
const LONG = 8000;

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
