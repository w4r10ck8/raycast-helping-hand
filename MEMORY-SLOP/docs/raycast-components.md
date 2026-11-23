# Raycast API cheat sheet

> **Source:** file — node_modules/@raycast/api/types/index.d.ts
> **Date:** 2026-11-12
> **Agent:** developer

---

## Summary

Checked against the installed `@raycast/api` 2.12.0 and `@raycast/utils` 2.3.3 type definitions. Full docs: <https://developers.raycast.com>.

## Pick a top-level view

A `view` command returns exactly one of these. Swap views with `Action.Push` / `useNavigation().push`.

| Need                                         | Use            | Notes                                                                                           |
| -------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| Searchable rows, optional right-hand preview | `List`         | `isShowingDetail` + `List.Item.Detail` gives the left/right split. The right side is read-only. |
| Searchable tiles with images                 | `Grid`         | `columns`, `aspectRatio`, `fit`, `inset`.                                                       |
| One page of rendered markdown                | `Detail`       | Optional `Detail.Metadata` sidebar.                                                             |
| Collect input                                | `Form`         | Single column only, no side-by-side fields.                                                     |
| Icon in the macOS menu bar                   | `MenuBarExtra` | Command needs `"mode": "menu-bar"` in `package.json`.                                           |

Every top-level view takes `isLoading` (the animated bar under the search bar, drawn in the theme's accent colour, can't be restyled), `navigationTitle` and `actions`.

## List

| Component                                      | What it renders                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `List`                                         | The list plus search bar. Key props: `isShowingDetail`, `filtering`, `searchText`, `onSearchTextChange`, `throttle`, `selectedItemId`, `onSelectionChange`, `searchBarPlaceholder`, `searchBarAccessory`, `pagination`. |
| `List.Item`                                    | A row: `title`, `subtitle`, `icon`, `accessories` (text/tag/date/icon), `keywords`, `detail`, `actions`, `quickLook`.                                                                                                   |
| `List.Item.Detail`                             | Right-hand pane for the selected item: `markdown`, `metadata`, `isLoading`.                                                                                                                                             |
| `List.Item.Detail.Metadata`                    | Key/value block in the detail pane.                                                                                                                                                                                     |
| `List.Item.Detail.Metadata.Label`              | Title + text/icon row.                                                                                                                                                                                                  |
| `List.Item.Detail.Metadata.Link`               | Title + clickable link.                                                                                                                                                                                                 |
| `List.Item.Detail.Metadata.TagList`            | Row of coloured tags (children: `.TagList.Item`).                                                                                                                                                                       |
| `List.Item.Detail.Metadata.Separator`          | Divider line.                                                                                                                                                                                                           |
| `List.Section`                                 | Titled group of items (`title`, `subtitle`).                                                                                                                                                                            |
| `List.Dropdown`                                | Dropdown in the search bar (use as `searchBarAccessory`).                                                                                                                                                               |
| `List.Dropdown.Item` / `List.Dropdown.Section` | Options and option groups.                                                                                                                                                                                              |
| `List.EmptyView`                               | Empty state: `icon`, `title`, `description`, `actions`.                                                                                                                                                                 |

## Grid

| Component                               | What it renders                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Grid`                                  | Tile layout. Same search/selection props as `List` plus `columns`, `aspectRatio`, `fit`, `inset`. |
| `Grid.Item`                             | A tile: `content` (image or `{ color }`), `title`, `subtitle`, `accessory`, `actions`.            |
| `Grid.Section`                          | Group of tiles, can override `columns`/`aspectRatio`/`fit`/`inset`.                               |
| `Grid.Dropdown` (+ `.Item`, `.Section`) | Search bar dropdown.                                                                              |
| `Grid.EmptyView`                        | Empty state.                                                                                      |
| `Grid.Fit` / `Grid.Inset`               | Enums for how images fill tiles and tile padding.                                                 |

## Detail

| Component                                                                         | What it renders                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Detail`                                                                          | Full-page markdown (`markdown`, `metadata`, `actions`, `isLoading`). Images: `![](file:///…?raycast-width=…&raycast-height=…)`. |
| `Detail.Metadata`                                                                 | Right-hand metadata sidebar.                                                                                                    |
| `Detail.Metadata.Label` / `.Link` / `.TagList` (+ `.TagList.Item`) / `.Separator` | Same as the List detail metadata items.                                                                                         |

## Form

Items are uncontrolled (`defaultValue`) or controlled (`value` + `onChange`). Every item takes `id` (required), `title`, `info`, `error`, `autoFocus`, `storeValue`, `onFocus`/`onBlur`. Refs expose `.focus()` and `.reset()`. Validation is easiest with `useForm` from `@raycast/utils`.

| Component                               | What it renders                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Form`                                  | The form. Props: `actions`, `enableDrafts`, `isLoading`, `navigationTitle`, `searchBarAccessory`.            |
| `Form.TextField`                        | Single-line input.                                                                                           |
| `Form.PasswordField`                    | Masked input (never saved to drafts).                                                                        |
| `Form.TextArea`                         | Multi-line input. `enableMarkdown` adds highlighting and ⌘B / ⌘I.                                            |
| `Form.Checkbox`                         | Checkbox, `label` is required.                                                                               |
| `Form.DatePicker`                       | Date or date-time (`type`, `min`, `max`). `Form.DatePicker.isFullDay()` helper.                              |
| `Form.Dropdown` (+ `.Item`, `.Section`) | Single select, searchable (`filtering`, `onSearchTextChange`, `throttle`).                                   |
| `Form.TagPicker` (+ `.Item`)            | Multi-select tokens, value is `string[]`.                                                                    |
| `Form.FilePicker`                       | File/folder chooser (`allowMultipleSelection`, `canChooseDirectories`, `canChooseFiles`, `showHiddenFiles`). |
| `Form.Description`                      | Read-only text row.                                                                                          |
| `Form.Separator`                        | Divider line.                                                                                                |
| `Form.LinkAccessory`                    | Link on the right of the search bar (`searchBarAccessory`).                                                  |

## Actions

Put actions in an `ActionPanel`. The first action runs on ↵, the second on ⌘↵. Every action takes `title`, `icon`, `shortcut`; custom ones take `style: Action.Style.Destructive` too.

| Component                 | What it does                                                                |
| ------------------------- | --------------------------------------------------------------------------- |
| `ActionPanel`             | The ⌘K panel.                                                               |
| `ActionPanel.Section`     | Titled group with dividers.                                                 |
| `ActionPanel.Submenu`     | Nested menu (`onOpen`, `onSearchTextChange`, `filtering`).                  |
| `Action`                  | Custom action: `onAction`.                                                  |
| `Action.CopyToClipboard`  | Copy `content` and close with a HUD (`concealed` skips clipboard history).  |
| `Action.Paste`            | Paste `content` into the frontmost app and close.                           |
| `Action.Push`             | Push a view onto the stack (`target`, `onPush`, `onPop`).                   |
| `Action.SubmitForm`       | Submit a `Form`. `onSubmit(values)`; blocked while any item has an `error`. |
| `Action.OpenInBrowser`    | Open `url` in the default browser.                                          |
| `Action.Open`             | Open a file/folder/URL, optionally with an `application`.                   |
| `Action.OpenWith`         | Submenu of apps that can open `path`.                                       |
| `Action.ShowInFinder`     | Reveal `path` in Finder.                                                    |
| `Action.Trash`            | Move `paths` to the Trash.                                                  |
| `Action.ToggleQuickLook`  | Quick Look the item's `quickLook` file.                                     |
| `Action.PickDate`         | Date picker inside the action panel (`onChange`).                           |
| `Action.CreateSnippet`    | Open Create Snippet prefilled.                                              |
| `Action.CreateQuicklink`  | Open Create Quicklink prefilled.                                            |
| `Action.InstallMCPServer` | Install an MCP server into Raycast.                                         |

## MenuBarExtra

| Component                | What it renders                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `MenuBarExtra`           | The menu bar icon/title (`icon`, `title`, `tooltip`, `isLoading`).                   |
| `MenuBarExtra.Item`      | Clickable menu row (`title`, `subtitle`, `icon`, `shortcut`, `onAction`, `tooltip`). |
| `MenuBarExtra.Section`   | Titled group.                                                                        |
| `MenuBarExtra.Submenu`   | Nested menu.                                                                         |
| `MenuBarExtra.Separator` | Divider.                                                                             |

## Non-UI APIs (`@raycast/api`)

| Area        | Call                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feedback    | `showToast` / `Toast` (animated, success, failure, with actions), `showHUD`, `confirmAlert` / `Alert`                                               |
| Navigation  | `useNavigation` (`push`, `pop`), `popToRoot`, `closeMainWindow`, `clearSearchBar`, `launchCommand`, `updateCommandMetadata`                         |
| Preferences | `getPreferenceValues`, `openExtensionPreferences`, `openCommandPreferences`                                                                         |
| Environment | `environment` (`appearance`, `supportPath`, `assetsPath`, `isDevelopment`, `launchType`, …)                                                         |
| Clipboard   | `Clipboard.copy`, `.paste`, `.read`, `.readText`, `.clear`                                                                                          |
| Storage     | `LocalStorage` (`getItem`, `setItem`, `removeItem`, `allItems`, `clear`), `Cache` (sync, LRU)                                                       |
| AI          | `AI.ask` (needs Raycast Pro), `AI.Model`                                                                                                            |
| Auth        | `OAuth.PKCEClient`                                                                                                                                  |
| System      | `open`, `getSelectedText`, `getSelectedFinderItems`, `getFrontmostApplication`, `getApplications`, `getDefaultApplication`, `showInFinder`, `trash` |
| Windows     | `WindowManagement` (`getActiveWindow`, `getWindowsOnActiveDesktop`, `getDesktops`, `setWindowBounds`)                                               |
| Browser     | `BrowserExtension` (`getTabs`, `getContent`)                                                                                                        |
| Look        | `Icon`, `Color`, `Image` (`Image.Mask`), `Keyboard.Shortcut` (incl. `Keyboard.Shortcut.Common`)                                                     |
| Errors      | `captureException`                                                                                                                                  |

## Hooks and helpers (`@raycast/utils`)

| Need                | Call                                                          |
| ------------------- | ------------------------------------------------------------- |
| Async data          | `usePromise`, `useCachedPromise`, `useFetch`, `useStreamJSON` |
| Shell / scripts     | `useExec`, `runAppleScript`, `runPowerShellScript`            |
| State that persists | `useLocalStorage`, `useCachedState`, `withCache`              |
| Forms               | `useForm` (+ `FormValidation`)                                |
| Sort by usage       | `useFrecencySorting`                                          |
| SQLite              | `useSQL`, `executeSQL`                                        |
| AI                  | `useAI`                                                       |
| OAuth               | `OAuthService`, `withAccessToken`, `getAccessToken`           |
| Icons               | `getFavicon`, `getAvatarIcon`, `getProgressIcon`              |
| Errors              | `showFailureToast`                                            |
| Deeplinks           | `createDeeplink`                                              |

## Limits worth remembering

- No custom CSS, layout or animation. Visual tricks go through markdown images (SVG/PNG/GIF), like [src/lib/header-image.ts](../../src/lib/header-image.ts).
- `Form` is one column, and a `List` detail pane can't hold inputs.
- The loading bar and accent colours come from the user's Raycast theme.
