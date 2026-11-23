import { Action, ActionPanel, Color, Form, Icon, Keyboard, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useLocalStorage, usePromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { type AzureConnection, CONNECTIONS_KEY, listMyTeams, testConnection } from "../lib/azure-devops";
import { Confirm } from "./confirm";

const TOKEN_SCOPES = "Work Items (Read & write), Project and Team (Read) for boards, Code (Read) for pull requests";

type Status = { checking: true } | { user: string } | { error: string };

function statusAccessory(status?: Status): List.Item.Accessory {
  if (!status || "checking" in status) return { text: "Checking…" };
  if ("user" in status) return { tag: { value: "Connected", color: Color.Green } };
  return { tag: { value: "Failed", color: Color.Red }, tooltip: status.error };
}

function statusLine(status?: Status) {
  if (!status || "checking" in status) return "_Checking connection…_";
  if ("user" in status) return `✅ Connected as **${status.user}**`;
  return `❌ ${status.error}`;
}

export function AzureConnections() {
  const {
    value: connections = [],
    setValue: setConnections,
    isLoading,
  } = useLocalStorage<Array<AzureConnection>>(CONNECTIONS_KEY, []);
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const { push } = useNavigation();

  async function test(connection: AzureConnection) {
    setStatuses((current) => ({ ...current, [connection.id]: { checking: true } }));
    const status = await testConnection(connection).then(
      (user): Status => ({ user }),
      (error): Status => ({ error: error instanceof Error ? error.message : String(error) }),
    );
    setStatuses((current) => ({ ...current, [connection.id]: status }));
  }

  // ponytail: tests every connection on open; cache results if the list grows past a handful.
  useEffect(() => {
    if (!isLoading) connections.forEach(test);
  }, [isLoading]);

  function upsert(saved: AzureConnection) {
    const exists = connections.some((connection) => connection.id === saved.id);
    // The first connection becomes the default so there's always one.
    const withDefault = { ...saved, default: saved.default || connections.length === 0 || undefined };
    setConnections(
      exists
        ? connections.map((connection) => (connection.id === saved.id ? withDefault : connection))
        : [...connections, withDefault],
    );
    test(withDefault);
  }

  function remove(removed: AzureConnection) {
    const rest = connections.filter((connection) => connection.id !== removed.id);
    if (removed.default && rest[0]) rest[0] = { ...rest[0], default: true };
    setConnections(rest);
  }

  const addAction = (
    <Action.Push
      title="Add Connection"
      icon={Icon.Plus}
      shortcut={Keyboard.Shortcut.Common.New}
      target={<ConnectionForm onSave={upsert} />}
    />
  );

  return (
    <List
      navigationTitle="Azure DevOps Connections"
      isLoading={isLoading}
      isShowingDetail={connections.length > 0}
      searchBarPlaceholder="Search connections…"
    >
      <List.EmptyView
        icon={Icon.Plug}
        title="No Azure DevOps connections"
        description={`Add one per organisation or project. Token scope needed: ${TOKEN_SCOPES}.`}
        actions={<ActionPanel>{addAction}</ActionPanel>}
      />
      {connections.map((connection) => (
        <List.Item
          key={connection.id}
          title={connection.name}
          icon={connection.default ? Icon.Star : Icon.Plug}
          accessories={[statusAccessory(statuses[connection.id])]}
          detail={
            <List.Item.Detail
              markdown={`## ${connection.name}\n\n${statusLine(statuses[connection.id])}`}
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label title="Organisation URL" text={connection.orgUrl} />
                  <List.Item.Detail.Metadata.Label title="Default Project" text={connection.project} />
                  <List.Item.Detail.Metadata.Label title="Personal Access Token" text="••••••••••••" />
                  <List.Item.Detail.Metadata.Label title="Board" text={connection.team || "Whole project"} />
                  <List.Item.Detail.Metadata.Label title="Default" text={connection.default ? "Yes" : "No"} />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <Action title="Test Connection" icon={Icon.Plug} onAction={() => test(connection)} />
              <Action.Push
                title="Edit Connection"
                icon={Icon.Pencil}
                shortcut={Keyboard.Shortcut.Common.Edit}
                target={<ConnectionForm initial={connection} onSave={upsert} />}
              />
              {addAction}
              {!connection.default && (
                <Action
                  title="Set as Default"
                  icon={Icon.Star}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
                  onAction={() =>
                    setConnections(
                      connections.map((each) => ({ ...each, default: each.id === connection.id || undefined })),
                    )
                  }
                />
              )}
              <Action
                title="Delete Connection"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={{ modifiers: ["ctrl"], key: "x" }}
                onAction={() =>
                  push(
                    <Confirm
                      title={`Delete “${connection.name}”?`}
                      message="The connection and its saved token are removed from Helping Hand. The token itself stays valid in Azure DevOps."
                      confirmTitle="Delete"
                      onConfirm={() => remove(connection)}
                    />,
                  )
                }
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function ConnectionForm({
  initial,
  onSave,
}: {
  initial?: AzureConnection;
  onSave: (connection: AzureConnection) => void;
}) {
  const { pop } = useNavigation();
  const [orgUrl, setOrgUrl] = useState(initial?.orgUrl ?? "");
  const [project, setProject] = useState(initial?.project ?? "");
  const [pat, setPat] = useState(initial?.pat ?? "");
  const [team, setTeam] = useState(initial?.team ?? "");
  const ready = /^https:\/\/\S+$/.test(orgUrl.trim()) && !!project.trim() && pat.trim().length >= 20;
  const {
    data: teams = [],
    isLoading: loadingTeams,
    error: teamsError,
  } = usePromise(
    (url: string, name: string, token: string) => listMyTeams({ orgUrl: url, project: name, pat: token }),
    [orgUrl.trim(), project.trim(), pat.trim()],
    { execute: ready, onError: () => undefined },
  );
  // Keep the saved board selectable while the list loads or if it can't be fetched.
  const boards = team && !teams.includes(team) ? [team, ...teams] : teams;

  return (
    <Form
      isLoading={loadingTeams}
      navigationTitle={initial ? `Edit “${initial.name}”` : "Add Azure DevOps Connection"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Connection"
            icon={Icon.Check}
            onSubmit={({ name }: { name: string }) => {
              if (!name.trim() || !project.trim() || !pat.trim() || !/^https:\/\/\S+$/.test(orgUrl.trim())) {
                showToast(Toast.Style.Failure, "Name, an https organisation URL, project and token are required");
                return;
              }
              onSave({
                id: initial?.id ?? crypto.randomUUID(),
                name: name.trim(),
                orgUrl: orgUrl.trim(),
                project: project.trim(),
                pat: pat.trim(),
                team: team || undefined,
                default: initial?.default,
              });
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="Name" placeholder="e.g. Client A" defaultValue={initial?.name} autoFocus />
      <Form.TextField
        id="orgUrl"
        title="Organisation URL"
        placeholder="https://dev.azure.com/your-org"
        value={orgUrl}
        onChange={setOrgUrl}
      />
      <Form.TextField id="project" title="Default Project" value={project} onChange={setProject} />
      <Form.PasswordField
        id="pat"
        title="Personal Access Token"
        value={pat}
        onChange={setPat}
        info={`Token scope needed: ${TOKEN_SCOPES}. Stored in Raycast's encrypted local storage, never in prompt files.`}
      />
      <Form.Dropdown
        id="team"
        title="Board"
        value={team}
        onChange={setTeam}
        info="Searches only show this board's areas, and sprint filters use its sprints. Type area:all in a search to see every area."
      >
        <Form.Dropdown.Item value="" title="Whole project" icon={Icon.Globe} />
        {boards.map((each) => (
          <Form.Dropdown.Item key={each} value={each} title={each} icon={Icon.AppWindowGrid3x3} />
        ))}
      </Form.Dropdown>
      {!ready && <Form.Description text="Fill in the organisation URL, project and token to load your boards." />}
      {ready && teamsError && <Form.Description text={`Couldn't load boards: ${teamsError.message}`} />}
    </Form>
  );
}
