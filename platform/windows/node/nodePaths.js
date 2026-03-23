const addPlatformNodeCandidates = (_add) => {
  // No additional default paths required on Windows. The scripts already consider
  // SHOTSTYLE_NODE and the current process runtime.
};

module.exports = { addPlatformNodeCandidates };
