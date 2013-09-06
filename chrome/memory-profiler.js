"use strict";

Cu.import("resource://gre/modules/devtools/Console.jsm");

let gMgr = Cc["@mozilla.org/memory-reporter-manager;1"]
             .getService(Ci.nsIMemoryReporterManager);

let gChildMemoryListener = undefined;
let gResult = {};

// Returns a promise of the memory footprint of the tab with the specified
// URL and (optionally) outer window ID.
function getMemoryFootprint(url, outerId)
{
  gResult = { total: 0, dom: 0, js: 0, other: 0 };
  let deferred = promise.defer();
  addChildObserversAndUpdate(() => {
    let os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    os.removeObserver(gChildMemoryListener, "child-memory-reporter-update");
    deferred.resolve(processMemoryReporters(url, outerId));
  });
  return deferred.promise;
}

function addChildObserversAndUpdate(aUpdateFn)
{
  let os = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
  os.notifyObservers(null, "child-memory-reporter-request", null);

  gChildMemoryListener = aUpdateFn;
  os.addObserver(gChildMemoryListener, "child-memory-reporter-update", false);

  gChildMemoryListener();
}

function processMemoryReporters(url, outerId)
{
  let e = gMgr.enumerateMultiReporters();
  while (e.hasMoreElements()) {
    let mr = e.getNext().QueryInterface(Ci.nsIMemoryMultiReporter);
    // |collectReports| never passes in a |presence| argument.
    let handleReport = function(aProcess, aUnsafePath, aKind,
                                aUnits, aAmount, aDescription) {
      if (!aUnsafePath.contains("strings/notable/string") &&
          flipBackslashes(aUnsafePath).contains(url) &&
          (!outerId || aUnsafePath.contains(", id=" + outerId))) {
        gResult.total += aAmount;
        // Now collect the more detailed measurements.
        let str = flipBackslashes(aUnsafePath);
        let index = str.lastIndexOf(url);
        str = str.slice(index+url.length);
        if (str.contains("/dom/")) {
          gResult.dom += aAmount;
        } else if (str.contains("/objects/") || str.contains("/objects-extra/")) {
          gResult.js += aAmount;
        } else {
          gResult.other += aAmount;
        }
      }
    }

    // We are only interested in the memory footprint of the current page.
    if (mr.name == "window-objects") {
      mr.collectReports(handleReport, null);
    }
  }
  return gResult;
}

function flipBackslashes(aUnsafeStr)
{
  // Save memory by only doing the replacement if it's necessary.
  return (aUnsafeStr.indexOf('\\') === -1)
         ? aUnsafeStr
         : aUnsafeStr.replace(/\\/g, '/');
}

function formatBytes(aBytes)
{
  let unit = " MB";

  let s;
  let mbytes = (aBytes / (1024 * 1024)).toFixed(2);
  let a = String(mbytes).split(".");
  // If the argument to formatInt() is -0, it will print the negative sign.
  s = formatInt(Number(a[0])) + "." + a[1] + unit;
  return s;
}

function formatInt(aN, aExtra)
{
  let neg = false;
  if (hasNegativeSign(aN)) {
    neg = true;
    aN = -aN;
  }
  let s = [];
  while (true) {
    let k = aN % 1000;
    aN = Math.floor(aN / 1000);
    if (aN > 0) {
      if (k < 10) {
        s.unshift(",00", k);
      } else if (k < 100) {
        s.unshift(",0", k);
      } else {
        s.unshift(",", k);
      }
    } else {
      s.unshift(k);
      break;
    }
  }
  if (neg) {
    s.unshift("-");
  }
  if (aExtra) {
    s.push(aExtra);
  }
  return s.join("");
}

function hasNegativeSign(aN)
{
  if (aN === 0) {                   // this succeeds for 0 and -0
    return 1 / aN === -Infinity;    // this succeeds for -0
  }
  return aN < 0;
}
