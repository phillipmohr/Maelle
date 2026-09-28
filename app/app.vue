<script setup lang="ts">
useHead({
  titleTemplate: (t) => (t ? `${t} · Maelle` : 'Maelle'),
})
</script>

<template>
  <TooltipProvider>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ClientOnly>
      <Toaster />
    </ClientOnly>
  </TooltipProvider>
</template>
