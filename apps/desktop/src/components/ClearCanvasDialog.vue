<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

defineProps<{
  componentCount: number;
  connectionCount: number;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
let returnFocus: HTMLElement | null = null;

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
    return;
  }
  if (event.key !== "Tab") return;
  if (event.shiftKey && document.activeElement === cancelButton.value) {
    event.preventDefault();
    confirmButton.value?.focus();
  } else if (!event.shiftKey && document.activeElement === confirmButton.value) {
    event.preventDefault();
    cancelButton.value?.focus();
  }
}

onMounted(async () => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  cancelButton.value?.focus();
});

onBeforeUnmount(() => returnFocus?.focus());
</script>

<template>
  <div class="dialog-backdrop" @keydown="onDialogKeydown">
    <section
      class="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="clear-canvas-title"
      aria-describedby="clear-canvas-description"
    >
      <span class="eyebrow">CLEAR CANVAS</span>
      <h2 id="clear-canvas-title">清空当前画布？</h2>
      <p id="clear-canvas-description">
        将移除 {{ componentCount }} 个元件和 {{ connectionCount }} 条连线。完成后仍可使用 Ctrl/Cmd+Z 恢复。
      </p>
      <div class="confirmation-dialog__actions">
        <button ref="cancelButton" type="button" class="dialog-button" @click="emit('cancel')">取消</button>
        <button ref="confirmButton" type="button" class="dialog-button dialog-button--danger" @click="emit('confirm')">清空画布</button>
      </div>
    </section>
  </div>
</template>
