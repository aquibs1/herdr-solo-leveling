// Notifications as the anime's System window: a dark translucent panel inside a neon-blue frame,
// "!" in a square box, the label in a glowing box (NOTIFICATION, ALERT, or WARNING), then the message.
// Same behavior as the shipped `toast`: click runs its action (e.g. go to the agent) and dismisses it;
// a machine-login notice offers Copy. Props: { title, body, level, icon, action, timeout, overlay }.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run } from "herdr";

const INK = "#f2f8ff", SOFT = "#c8d7e8", NEON = "#3fa9ff", CYAN = "#7fe6ff";
const LABEL = { error: ["WARNING", "#ff6b8a"], warning: ["ALERT", "#ffd36b"] };

export default class SlToast extends View {
  render() {
    const p = props() ?? {};
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const [label, tint] = LABEL[p.level] ?? ["NOTIFICATION", CYAN];
    const title = String(p.title ?? "").replace(/^\[SYSTEM\]\s*/, "");
    const box = (child, w) => div().flex_none().border(1).border_color(tint + "cc").bg(tint + "14").flex().items_center().justify_center().when(!!w, (e) => e.w(w)).child(child);
    return div().id("sl-toast").relative().size_full().bg("#020a1ce8").cursor_pointer()
      .border(2).border_color(NEON)                                                             // neon frame
      .child(div().absolute().top(3).left(3).right(3).bottom(3).border(1).border_color("#ffffff40")) // thin inner line
      .child(div().absolute().top(-1).left(18).w(60).h(3).bg(CYAN)).child(div().absolute().bottom(-1).right(18).w(60).h(3).bg(CYAN))
      .hover((s) => s.bg("#061633f0"))
      .on_click(() => { if (p.action?.name) run(p.action.name, p.action.args ?? {}); closeOverlay(p.overlay); })
      .child(h_flex().size_full().px(14).gap(12).items_center()
        .child(box(div().text_size(15).font_bold().text_color(INK).child("!"), 28).h(28))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(8).items_center()
            .child(box(div().px(8).font_family("DIN Condensed").text_size(14).text_color(tint).child(label)).h(20))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(INK)
              .child(login ? `${login[1]} needs a login: run` : title)))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(11.5).text_color(SOFT).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).text_size(11.5).text_color(SOFT).child(command))
            .child(div().id("sl-toast-copy").flex_none().px(8).py(2).border(1).border_color(tint).text_size(11).text_color(tint)
              .hover((s) => s.bg(tint + "22"))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "Copied" : "Copy"))))));
  }
}
