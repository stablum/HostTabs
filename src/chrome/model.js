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

  function getLastAccessedTab(tabRecords) {
    let selected = null;
    let selectedTimestamp = -1;
    for (const record of tabRecords) {
      const timestamp = Number.isFinite(record.lastAccessed)
        ? record.lastAccessed
        : -1;
      if (
        !selected ||
        record.active ||
        (!selected.active && timestamp > selectedTimestamp)
      ) {
        selected = record;
        selectedTimestamp = timestamp;
      }
    }
    return selected;
  }

  function getGroupClosePlan(group) {
    const tabs = group?.tabs || [];
    const target = tabs.find(record => record.active) || getLastAccessedTab(tabs);
    if (!target) {
      return { target: null, next: null };
    }
    return {
      target,
      next: getLastAccessedTab(tabs.filter(record => record !== target)),
    };
  }

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
          lastAccessedTab: null,
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

    const groups = [...byLabel.values()].sort((a, b) => a.position - b.position);
    for (const group of groups) {
      group.lastAccessedTab = getLastAccessedTab(group.tabs);
    }
    return groups;
  }

  return { buildGroups, getLastAccessedTab, getGroupClosePlan };
});
