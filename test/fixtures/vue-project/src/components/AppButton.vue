<template>
  <BaseButton class="app-btn">
    {{ label }}
  </BaseButton>
  <TestComponent></TestComponent>
</template>

<script setup>
import BaseButton from './BaseButton.vue'

defineProps({
  label: String
})
</script>