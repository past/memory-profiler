/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu, results: Cr } = Components;

this.EXPORTED_SYMBOLS = ["MemoryProfilerPanel"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

XPCOMUtils.defineLazyModuleGetter(this, "EventEmitter",
  "resource:///modules/devtools/shared/event-emitter.js");
XPCOMUtils.defineLazyModuleGetter(this, "promise",
  "resource://gre/modules/commonjs/sdk/core/promise.js", "Promise");

this.MemoryProfilerPanel = function MemoryProfilerPanel(iframeWindow, toolbox) {
  this.panelWin = iframeWindow;
  this._toolbox = toolbox;
  this._destroyer = null;
  this.controller = null;

  EventEmitter.decorate(this);
};

MemoryProfilerPanel.prototype = {
  open: function() {
    let panelLoaded = promise.defer();
    let panelWin = this.panelWin;
    this.controller = new panelWin.MemoryController();

    // Make sure the iframe content window is ready.
    panelWin.addEventListener("load", function onLoad() {
      panelWin.removeEventListener("load", onLoad, true);
      panelLoaded.resolve();
    }, true);

    return panelLoaded.promise
      .then(() => this.controller.startup(this._toolbox))
      .then(() => {
        this.isReady = true;
        this.emit("ready");
        return this;
      })
      .then(null, function onError(aReason) {
        console.error(aReason);
      });
  },

  // DevToolPanel API

  get target() this._toolbox.target,

  destroy: function() {
    // Make sure this panel is not already destroyed.
    if (this._destroyer) {
      return this._destroyer;
    }

    return this._destroyer = this.controller.shutdown()
      .then(() => {
        this.isReady = false;
        this.emit("destroyed");
      })
      .then(null, function onError(aReason) {
        Cu.reportError("MemoryProfilerPanel destroy failed. " +
                       aReason.error + ": " + aReason.message);
      });
  }
};
