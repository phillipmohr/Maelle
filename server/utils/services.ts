/**
 * Service registry. Starts with the stubs from `shared/services-stubs`; each owning ticket registers
 * its real implementation from a Nitro plugin in its own folder:
 *
 *   // server/plugins/mail.ts (IRDR-455)
 *   export default defineNitroPlugin(() => registerService('mail', createMailService()))
 *
 * Consumers always go through `services.<name>` (or `useServices()`), never import an implementation.
 */
import type { ServiceName, Services } from '#shared/services'
import { createStubServices } from '#shared/services-stubs'

const g = globalThis as unknown as {
  __maelleServices?: Services
  __maelleRegistered?: Set<ServiceName>
}

function registry(): Services {
  if (!g.__maelleServices) {
    g.__maelleServices = createStubServices((msg) => {
      if (process.env.NODE_ENV !== 'test') console.info(msg)
    })
    g.__maelleRegistered = new Set()
  }
  return g.__maelleServices
}

export const services: Services = new Proxy({} as Services, {
  get(_t, prop: string) {
    return registry()[prop as ServiceName]
  },
})

export function useServices(): Services {
  return services
}

export function registerService<K extends ServiceName>(name: K, impl: Services[K]): void {
  registry()[name] = impl
  g.__maelleRegistered!.add(name)
}

/** True when the real implementation (not the stub) is registered. */
export function isServiceRegistered(name: ServiceName): boolean {
  registry()
  return g.__maelleRegistered!.has(name)
}

/** Tests only: put the stubs back. */
export function resetServicesForTests(): void {
  g.__maelleServices = undefined
  g.__maelleRegistered = undefined
}
