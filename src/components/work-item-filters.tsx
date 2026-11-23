import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { type AzureConnection, type Filters, listIterations, listTypesAndStates } from "../lib/azure-devops";

type Values = {
  assignee: string;
  type: Array<string>;
  state: Array<string>;
  sprint: string;
  area: string;
  parent: string;
  tag: string;
};

const list = (value: string) =>
  value
    .split(",")
    .map((each) => each.trim())
    .filter(Boolean);

/** Turns form values into Filters, leaving out anything blank so it doesn't override presets. */
function toFilters(values: Values): Filters {
  const filters: Filters = {};
  if (values.assignee.trim()) filters.assignee = values.assignee.trim().replace(/^@/, "");
  if (values.type.length) filters.type = values.type;
  if (values.state.length) filters.state = values.state;
  if (values.sprint) filters.sprint = values.sprint;
  if (values.area.trim()) filters.area = values.area.trim();
  const parent = Number(values.parent.trim().replace(/^#/, ""));
  if (Number.isInteger(parent) && parent > 0) filters.parent = parent;
  if (list(values.tag).length) filters.tag = list(values.tag);
  return filters;
}

export function WorkItemFilters({
  connection,
  initial,
  onApply,
}: {
  connection: AzureConnection;
  initial: Filters;
  onApply: (filters: Filters) => void;
}) {
  const { pop } = useNavigation();
  const { data: meta, isLoading: loadingMeta } = usePromise(listTypesAndStates, [connection]);
  const { data: iterations = [], isLoading: loadingSprints } = usePromise(listIterations, [connection]);

  return (
    <Form
      navigationTitle="Filter Work Items"
      isLoading={loadingMeta || loadingSprints}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Apply Filters"
            icon={Icon.Filter}
            onSubmit={(values: Values) => {
              onApply(toFilters(values));
              pop();
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="assignee"
        title="Assigned To"
        placeholder="me or part of a name"
        defaultValue={initial.assignee}
      />
      <Form.TagPicker id="type" title="Types" defaultValue={initial.type}>
        {(meta?.types ?? initial.type ?? []).map((type) => (
          <Form.TagPicker.Item key={type} value={type} title={type} />
        ))}
      </Form.TagPicker>
      <Form.TagPicker id="state" title="States" defaultValue={initial.state}>
        {(meta?.states ?? initial.state ?? []).map((state) => (
          <Form.TagPicker.Item key={state} value={state} title={state} />
        ))}
      </Form.TagPicker>
      <Form.Dropdown id="sprint" title="Sprint" defaultValue={initial.sprint ?? ""}>
        <Form.Dropdown.Item value="" title="Any" />
        <Form.Dropdown.Item value="current" title="@CurrentIteration" />
        <Form.Dropdown.Item value="previous" title="@CurrentIteration - 1" />
        <Form.Dropdown.Item value="next" title="@CurrentIteration + 1" />
        <Form.Dropdown.Section title="Sprints">
          {iterations.map((each) => (
            <Form.Dropdown.Item key={each.path} value={each.path} title={each.name} />
          ))}
        </Form.Dropdown.Section>
      </Form.Dropdown>
      <Form.TextField
        id="area"
        title="Area"
        placeholder={connection.team ? `Default: ${connection.team} board's areas (all = every area)` : "e.g. MyFWC"}
        defaultValue={initial.area}
      />
      <Form.TextField id="parent" title="Parent Work Item" placeholder="ID" defaultValue={initial.parent?.toString()} />
      <Form.TextField id="tag" title="Tags" placeholder="comma separated" defaultValue={initial.tag?.join(", ")} />
    </Form>
  );
}
