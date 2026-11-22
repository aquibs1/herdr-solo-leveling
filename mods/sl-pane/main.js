// A pane header in the Solo Leveling System's style, for the solo-leveling layout:
//   ⓘ NAME  folder ───────────── [state] [split →] [split ↓]  —  ✕
// "—" zooms the pane in or out, "✕" closes it (as the shipped `pane` header's buttons do).
// Props from the app: { pane, terminal }. Click: focus the pane.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";

const INK = "#e8f7ff", FILIGREE = "#7fe6ff", RED = "#ff6b8a";
const TITLE_FONT = "DIN Condensed";

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class SlPane extends View {
  init() { this.hovered = false; }
  me() { return panes().find((p) => p.pane === props()?.pane); }

  icon(id, glyph, command, args, tip) {
    return div().id(id).w(26).h(22).flex().items_center().justify_center().rounded(5).text_color("#d8f4ffbb")
      .hover((s) => s.bg("#ffffff18").text_color(INK)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); run(command, args); })
      .child(glyph);
  }

  render() {
    const t = theme(), p = this.me();
    if (!p) return div();
    const name = p.mod === "sl-system" ? "The System" : ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const pane = p.pane, st = p.status;
    return h_flex().id(`slp-${pane}`).size_full().px(14).gap(10).items_center()
      .bg(p.focused ? "#0b204899" : "#06122a99").border_b(1).border_color(FILIGREE + (p.focused ? "88" : "44"))
      .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .child(div().size(16).flex_none().rounded(8).border(2).border_color("#ffffff").flex().items_center().justify_center()
        .text_size(10).font_bold().text_color(RED).child("!"))
      .child(div().flex_none().truncate().max_w(280).font_family(TITLE_FONT).text_size(16).text_color(INK).child(name.toUpperCase()))
      .child(div().flex_none().truncate().max_w(320).text_size(11).text_color("#d3e0ee").child(folder(p.cwd)))
      .child(h_flex().flex_1().min_w(24).items_center()
        .child(div().w(30).h(1).bg(FILIGREE + "22")).child(div().flex_1().h(1).bg(FILIGREE + "66")).child(div().w(30).h(1).bg(FILIGREE + "22")))
      .when(st === "working", (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(st === "blocked", (el) => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(t.blocked + "33")
        .font_family(TITLE_FONT).text_size(13).text_color(t.blocked).child("AWAITS COMMAND")))
      .when(st === "done", (el) => el.child(div().size(7).flex_none().rounded(4).bg(t.done)))
      .when(this.hovered, (el) => el
        .child(this.icon(`slp-r-${pane}`, svg("mods/pane/split-right.svg").size(13), "pane.split", { direction: "right", pane }, "Split right"))
        .child(this.icon(`slp-d-${pane}`, svg("mods/pane/split-down.svg").size(13), "pane.split", { direction: "down", pane }, "Split down")))
      .child(this.icon(`slp-z-${pane}`, div().text_size(14).child("—"), "pane.zoom", { pane }, p.zoomed ? "Unzoom" : "Zoom"))
      .child(this.icon(`slp-x-${pane}`, div().text_size(13).child("✕"), "pane.close", { pane }, "Close this pane"));
  }
}
