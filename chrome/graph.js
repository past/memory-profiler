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

function graph(canvas, values) {
  let ctx = canvas.context;
  let element = canvas.element;
  let h = element.clientHeight;
  let w = element.clientWidth;
  let count = values.length;
  let max = Math.max.apply(null, values);

  // Clear the existing graph.
  ctx.clearRect(0, 0, element.width, element.height);
  // Draw the new one.
  ctx.strokeStyle = "steelblue";
  ctx.beginPath();
  ctx.moveTo(0, h - (h * values[0] / max));
  for (let i = 0, len = count; i <= len - 1; i++) {
    ctx.lineTo(w * (i + 1) / count,
               h - (h * values[i] / max));
  }
  ctx.stroke();
}
