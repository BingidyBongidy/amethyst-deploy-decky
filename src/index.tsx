import { staticClasses } from "@decky/ui";
import { definePlugin, routerHook } from "@decky/api";
import { FaGem } from "react-icons/fa";
import { AmethystPage } from "./AmethystPage";
import { QuickAccessPanel } from "./qam/QuickAccessPanel";
import { addGlobalListeners } from "./qam/globalListeners";

export default definePlugin(() => {
  routerHook.addRoute("/amethyst", AmethystPage, { exact: true });
  const removeGlobalListeners = addGlobalListeners();

  return {
    name: "Amethyst Deploy",
    titleView: <div className={staticClasses.Title}>Amethyst Deploy</div>,
    content: <QuickAccessPanel />,
    icon: <FaGem />,
    onDismount() {
      removeGlobalListeners();
      routerHook.removeRoute("/amethyst");
    },
  };
});
