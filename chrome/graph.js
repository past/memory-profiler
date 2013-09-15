/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

var px  = (num)  => parseInt(num, 10) + "px";

function createCanvas(opts) {
  var el = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");

  el.style.height = px(opts.height);
  el.style.width = px(opts.width);
  el.height = opts.height;
  el.width = opts.width;

  return {
    element: el,
    context: el.getContext("2d")
  };
}

function graph(controller, profile) {
  let values = profile.measurements;
  let gcevents = profile.events;
  let ctx = controller.canvas.context;
  let element = controller.canvas.element;
  let h = element.clientHeight;
  let w = element.clientWidth;
  let count = values.total.length;
  let max = Math.max.apply(null, values.total);
  let min = Math.min.apply(null, values.total);
  // Use half the canvas when min and max aren't that far off.
  let top = min > max * 0.1 ? h / 2 : h;

  // Clear the existing graph before drawing the new one.
  ctx.clearRect(0, 0, element.width, element.height);

  ctx.lineJoin = "round";
  // Graph the total memory allocated.
  ctx.beginPath();
  ctx.moveTo(0, h - (top * values.total[0] / max));
  for (let i = 0, len = count; i <= len - 1; i++) {
    ctx.lineTo(w * (i + 1) / count,
               h - (top * values.total[i] / max));
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.lineTo(0, 0);
  ctx.fillStyle = "#353c45";
  ctx.fill();
  ctx.strokeStyle = "#525c66";
  ctx.stroke();
  ctx.closePath();

  // Graph the rest of the categories.
  let categories = [ "dom", "js", "other" ];
  let colors = [ "#b987bc", "#46afe3", "#6b7abb" ];
  for (let c = 0; c < categories.length; c++) {
    let catCount = values[categories[c]].length;
    ctx.beginPath();
    ctx.strokeStyle = colors[c];
    ctx.moveTo(0, h - (top * values[categories[c]][0] / max));
    for (let i = 0, len = catCount; i <= len - 1; i++) {
      ctx.lineTo(w * (i + 1) / catCount,
                 h - (top * values[categories[c]][i] / max));
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.stroke();
    ctx.closePath();
  }

  // Draw the GC markers.
  let eventCount = gcevents.length;
  ctx.beginPath();
  ctx.strokeStyle = "rgba(70, 175, 227, 0.3)";
  for (let i = 0, len = eventCount; i <= len - 1; i++) {
    if (gcevents[i].type == "gc") {
      let x = w * (gcevents[i].time + 1) / count;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
  }
  ctx.stroke();
  ctx.closePath();

  // Draw the CC markers.
  ctx.beginPath();
  ctx.strokeStyle = "rgba(185, 135, 188, 0.3)";
  for (let i = 0, len = eventCount; i <= len - 1; i++) {
    if (gcevents[i].type == "cc") {
      let x = w * (gcevents[i].time + 1) / count;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
  }
  ctx.stroke();
  ctx.closePath();

  // Display the total memory usage.
  ctx.font = "14px Arial";
  ctx.beginPath();
  ctx.fillStyle = "#b6babf";
  let text = formatBytes(values.total[values.total.length-1]);
  ctx.fillText(text, w - (text.length * 14) - 42, 16);
  ctx.closePath();

  // Draw the background.
  ctx.strokeStyle = "white";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(w, h);
  ctx.stroke();
  ctx.closePath();
}

function resetGraph(controller) {
  let ctx = controller.canvas.context;
  let element = controller.canvas.element;
  let h = element.clientHeight;
  let w = element.clientWidth;

  ctx.clearRect(0, 0, element.width, element.height);
  // Draw the background.
  ctx.strokeStyle = "white";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(w, h);
  ctx.stroke();
  ctx.closePath();
}
