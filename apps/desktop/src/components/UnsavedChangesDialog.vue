<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";

/**
 * 打开/新建前的未保存改动确认：沿用清空画布确认的交互（Esc 取消、焦点圈定、关闭后焦点还原）。
 * 确认意味着放弃当前文档的未保存改动，继续执行挂起的文件操作。
 */
const props = defineProps<{
  /** 挂起的文件操作；文案随它变化。 */
  action: "open" | "new";
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
let returnFocus: HTMLElement | null = null;

const COPY = {
  open: { title: "打开项目文件？", description: "当前文档有未保存的改动，打开后这些改动将丢失。" },
  new: { title: "新建文档？", description: "当前文档有未保存的改动，新建后这些改动将丢失。" },
} as const;

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

const copy = COPY[props.action];
</script>

<template>
  <div class="dialog-backdrop" @keydown="onDialogKeydown">
    <section
      class="confirmation-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unsaved-changes-title"
      aria-describedby="unsaved-changes-description"
    >
      <span class="eyebrow">UNSAVED CHANGES</span>
      <h2 id="unsaved-changes-title">{{ copy.title }}</h2>
      <p id="unsaved-changes-description">{{ copy.description }}</p>
      <div class="confirmation-dialog__actions">
        <button ref="cancelButton" type="button" class="dialog-button" @click="emit('cancel')">取消</button>
        <button ref="confirmButton" type="button" class="dialog-button dialog-button--danger" @click="emit('confirm')">
          {{ action === "open" ? "放弃改动并打开" : "放弃改动并新建" }}
        </button>
      </div>
    </section>
  </div>
</template>
