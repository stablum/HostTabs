(function (root, factory) {
  const urlApi =
    typeof module === "object" && module.exports
      ? require("./url-groups.js")
      : root.HostTabs;
  const api = factory(urlApi);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.HostTabs = root.HostTabs || {};
    Object.assign(root.HostTabs, api);
  }
})(globalThis, function (urlApi) {
  "use strict";
  const getGroupForURL = urlApi.getGroupForURL;

  function buildGroups(tabRecords) {
    const byLabel = new Map();
    const ordered = [...tabRecords].sort((a, b) => a.position - b.position);

    for (const record of ordered) {
      const label = getGroupForURL(record.url);
      let group = byLabel.get(label);
      if (!group) {
        group = {
          label,
          position: record.position,
          tabs: [],
          active: false,
          favicon: "",
          lastAccessed: -1,
          lastAccessedTab: null,
        };
        byLabel.set(label, group);
      }
      group.tabs.push(record);
      group.position = Math.min(group.position, record.position);
      group.active ||= Boolean(record.active);
      const lastAccessed = Number.isFinite(record.lastAccessed)
        ? record.lastAccessed
        : -1;
      if (
        !group.lastAccessedTab ||
        record.active ||
        (!group.lastAccessedTab.active && lastAccessed > group.lastAccessed)
      ) {
        group.lastAccessed = lastAccessed;
        group.lastAccessedTab = record;
      }
      if (!group.favicon && record.favicon) {
        group.favicon = record.favicon;
      }
    }

    return [...byLabel.values()].sort((a, b) => a.position - b.position);
  }

  return { buildGroups };
});
