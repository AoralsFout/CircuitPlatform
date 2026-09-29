<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { PendingDefinitionDeletion } from "../composables/useWorkspace.ts";

defineProps<{ pending: PendingDefinitionDeletion }>();
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
    if (event.shiftKey && document.activeElement === cancelButton.value) {
      event.preventDefault();
      confirmButton.value?.focus();
    } else if (!event.shiftKey && document.activeElement === confirmButton.value) {
      event.preventDefault();
      cancelButton.value?.focus();
    }
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
    <section class="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-definition-title" aria-describedby="delete-definition-description">
      <span class="eyebrow">DELETE DEFINITION</span>
      <h2 id="delete-definition-title">删除“{{ pending.displayName }}”？</h2>
      <p id="delete-definition-description">这份定义仍被以下 {{ pending.uses.length }} 处使用。确认后保留使用处的元件、端口和连线，并标记为“定义缺失”。{{ pending.removedDefinitionIds.length > 1 ? `同时清理 ${pending.removedDefinitionIds.length - 1} 个仅属于它的下层定义。` : '' }}可以用撤销恢复。</p>
      <ul class="definition-delete-uses">
        <li v-for="use in pending.uses" :key="`${use.ownerDefinitionId ?? 'root'}:${use.componentId}`">{{ use.location }}</li>
      </ul>
      <div class="confirmation-dialog__actions">
        <button ref="cancelButton" type="button" class="dialog-button" @click="emit('cancel')">取消</button>
        <button ref="confirmButton" type="button" class="dialog-button dialog-button--danger" @click="emit('confirm')">确认删除定义</button>
      </div>
    </section>
  </div>
</template>
