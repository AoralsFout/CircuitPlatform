<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { PendingReimportPreview } from "../composables/useWorkspace.ts";

defineProps<{ preview: PendingReimportPreview }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const cancelButton = ref<HTMLButtonElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
let returnFocus: HTMLElement | null = null;

function onKeydown(event: KeyboardEvent): void {
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
  <div class="dialog-backdrop" @keydown="onKeydown">
    <section class="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reimport-impact-title" aria-describedby="reimport-impact-description">
      <span class="eyebrow">SUBCIRCUIT UPDATE</span>
      <h2 id="reimport-impact-title">重新导入会使连线悬空</h2>
      <p id="reimport-impact-description">“{{ preview.displayName }}”的新 Port 与现有连线不兼容。确认后连线会保留，供你逐条修复。</p>
      <ul class="reimport-impact-list">
        <li v-for="(impact, index) in preview.impacts" :key="`${impact.connectionId}:${impact.componentId}:${impact.portName}:${index}`">
          连接“{{ impact.connectionId }}” · 元件“{{ impact.componentId }}”的 Port“{{ impact.portName }}”
          （{{ impact.oldPort.direction === 'input' ? '输入' : '输出' }} {{ impact.oldPort.width }} 位 →
          {{ impact.newPort ? `${impact.newPort.direction === 'input' ? '输入' : '输出'} ${impact.newPort.width} 位` : '已删除或改名' }}）
        </li>
      </ul>
      <div class="confirmation-dialog__actions">
        <button ref="cancelButton" type="button" class="dialog-button" @click="emit('cancel')">取消</button>
        <button ref="confirmButton" type="button" class="dialog-button dialog-button--danger" @click="emit('confirm')">确认重新导入</button>
      </div>
    </section>
  </div>
</template>
