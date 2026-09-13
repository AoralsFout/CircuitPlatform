import { computed, readonly, ref, type ComputedRef, type DeepReadonly, type Ref } from "vue";

export type ThemePreference = "system" | "light" | "dark";

interface ThemeBinding {
  preference: DeepReadonly<Ref<ThemePreference>>;
  label: ComputedRef<string>;
  restore(): void;
  setPreference(theme: ThemePreference): void;
  cycle(): void;
}

const themeStorageKey = "circuit-platform-theme";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * 管理工作区主题偏好，并负责 document 同步与本地持久化。
 * @returns 当前偏好、展示标签，以及恢复、设置和循环切换操作。
 */
export function useThemePreference(): ThemeBinding {
  const preference = ref<ThemePreference>("system");
  const label = computed(() => {
    if (preference.value === "light") return "浅色主题";
    if (preference.value === "dark") return "深色主题";
    return "跟随系统";
  });

  function setPreference(theme: ThemePreference): void {
    preference.value = theme;
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = theme;
    }
    localStorage.setItem(themeStorageKey, theme);
  }

  function restore(): void {
    const storedTheme = localStorage.getItem(themeStorageKey);
    if (isThemePreference(storedTheme)) setPreference(storedTheme);
  }

  function cycle(): void {
    const nextTheme: Record<ThemePreference, ThemePreference> = {
      system: "light",
      light: "dark",
      dark: "system",
    };
    setPreference(nextTheme[preference.value]);
  }

  return {
    preference: readonly(preference),
    label,
    restore,
    setPreference,
    cycle,
  };
}
