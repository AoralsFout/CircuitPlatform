<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { PendingSaveConflict } from "../composables/useDocumentWorkspace";

const props = defineProps<{ conflict: PendingSaveConflict }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
let returnFocus: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("cancel");
  } else if (event.key === "Tab") {
    const active = document.activeElement;
    if (event.shiftKey && active === cancelButton.value) { event.preventDefault(); confirmButton.value?.focus(); }
    else if (!event.shiftKey && active === confirmButton.value) { event.preventDefault(); cancelButton.value?.focus(); }
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
  <div class="dialog-backdrop" @keydown="onKeydown">
    <section class="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="save-conflict-title" aria-describedby="save-conflict-description">
      <span class="eyebrow">SAVE CONFLICT</span>
      <h2 id="save-conflict-title">替换已打开的项目？</h2>
      <p id="save-conflict-description">
        “{{ props.conflict.targetDisplayName }}”已经打开。确认后将用“{{ props.conflict.sourceDisplayName }}”的当前内容替换磁盘文件，并关闭目标标签。
        <span v-if="props.conflict.targetIsDirty">目标标签的未保存改动将被丢弃。</span>
      </p>
      <div class="confirmation-dialog__actions">
        <button ref="cancelButton" type="button" class="dialog-button" @click="emit('cancel')">取消</button>
        <button ref="confirmButton" type="button" class="dialog-button dialog-button--danger" @click="emit('confirm')">替换并关闭目标</button>
      </div>
    </section>
  </div>
</template>
