// Embed shim for Origami Simulator inside Origami-App.
// Loaded after js/main.js. Adds messages on top of the simulator's own
// importFold / importSVG API (js/importer.js):
//   {op: "setFoldPercent", value: 0..1}
//   {op: "resetView"}
// and reports warnings to the parent instead of opening a modal.
(function () {
  function post(msg) {
    var target = window.parent !== window ? window.parent : window.opener;
    if (target) target.postMessage(Object.assign({ from: "OrigamiSimulator" }, msg), "*");
  }

  $(function () {
    globals.creasePercent = 1;
    globals.shouldChangeCreasePercent = true;
    globals.warn = function (msg) {
      post({ status: "warning", message: String(msg) });
    };

    window.addEventListener("message", function (e) {
      if (!e.data) return;
      if (e.data.op === "setFoldPercent" && typeof e.data.value === "number") {
        globals.creasePercent = e.data.value;
        globals.shouldChangeCreasePercent = true;
      } else if (e.data.op === "resetView") {
        globals.threeView.resetModel();
      } else if (e.data.op === "importFold" || e.data.op === "importSVG") {
        // The simulator handles these itself; confirm so the parent can show state.
        setTimeout(function () {
          post({ status: "loaded", op: e.data.op });
        }, 0);
      }
    });
  });
})();
