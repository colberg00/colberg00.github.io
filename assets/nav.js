/* Shared masthead behaviour: the case-files dropdown is a native <details>, so
   it opens and closes on its own with no script at all. This only adds the two
   conveniences the browser doesn't: close it when you click outside, and close
   it on Escape. */
(function () {
  "use strict";
  const menus = Array.from(document.querySelectorAll("details.wlf-cases"));
  if (!menus.length) return;

  document.addEventListener("click", (e) => {
    menus.forEach((menu) => {
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    menus.forEach((menu) => {
      if (menu.open) {
        menu.open = false;
        const summary = menu.querySelector("summary");
        if (summary) summary.focus();
      }
    });
  });
})();
