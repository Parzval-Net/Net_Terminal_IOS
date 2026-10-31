/** "1 sesión" / "3 sesiones": cantidad con el sustantivo en singular o plural. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
