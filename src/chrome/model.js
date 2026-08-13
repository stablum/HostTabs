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
        };
        byLabel.set(label, group);
      }
      group.tabs.push(record);
      group.position = Math.min(group.position, record.position);
      group.active ||= Boolean(record.active);
      if (!group.favicon && record.favicon) {
        group.favicon = record.favicon;
      }
    }

    return [...byLabel.values()].sort((a, b) => a.position - b.position);
  }

  return { buildGroups };
});
