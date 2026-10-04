/**
 * Optional features, switched on per company by the operator.
 *
 * Some customers ask for something the rest do not need — a print shop wants a
 * price list to pick lines from, someone else will want something else. Rather
 * than fork the app or grow a settings screen full of toggles nobody asked for,
 * each such feature is a module: off by default, invisible while off, and
 * enabled for one company at a time from the admin screen.
 *
 * The switch is `company.modules[id]`. The security rules let only the operator
 * change it, so a module is a real entitlement rather than a hidden menu entry —
 * and the rules for a module's own data check it too (see `firestore.rules`).
 *
 * Adding a module: an entry here, its id in `ModuleId`, and the feature's code
 * gated on `CompanyService.hasModule(id)` / `moduleGuard(id)`. The admin
 * screen picks it up from this list on its own.
 */

export type ModuleId = 'catalog';

export interface AppModule {
  id: ModuleId;
  /** What the operator sees on the admin screen, and the customer in the nav. */
  name: string;
  /** One sentence for the operator: what the customer gets when it is on. */
  description: string;
  icon: string;
}

export const MODULES: readonly AppModule[] = [
  {
    id: 'catalog',
    name: 'Ценовник',
    description:
      'Листа на производи и услуги со цени. При фактурирање ставките се бираат од листата наместо да се пишуваат секој пат.',
    icon: 'sell',
  },
];

/** On/off per module. Absent means off — companies predate this field. */
export type CompanyModules = Partial<Record<ModuleId, boolean>>;

export function hasModule(modules: CompanyModules | null | undefined, id: ModuleId): boolean {
  return modules?.[id] === true;
}

/** The modules switched on, in registry order — for chips and summaries. */
export function enabledModules(modules: CompanyModules | null | undefined): AppModule[] {
  return MODULES.filter((module) => hasModule(modules, module.id));
}
