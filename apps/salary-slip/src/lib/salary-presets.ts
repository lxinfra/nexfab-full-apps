// Ready-made monthly salary structures offered on the employee form.
// The "in hand" figure holds with the default deduction rules (PT 208, TDS 10% of gross, PF and ESI at 0).

export interface SalaryPreset {
  id: string;
  label: string;
  inHand: number;
  components: { name: string; monthlyAmount: number }[];
}

const preset = (
  inHand: number,
  label: string,
  [basic, hra, communication, special, travel]: [number, number, number, number, number],
): SalaryPreset => ({
  id: String(inHand),
  label,
  inHand,
  components: [
    { name: "Basic Salary", monthlyAmount: basic },
    { name: "House Rent Allowance", monthlyAmount: hra },
    { name: "Communication Allowance", monthlyAmount: communication },
    { name: "Special Allowance", monthlyAmount: special },
    { name: "Defray Travel Expense", monthlyAmount: travel },
  ],
});

export const SALARY_PRESETS: SalaryPreset[] = [
  preset(100000, "₹1,00,000 in hand (gross ₹1,11,342)", [55671, 27836, 5000, 2835, 20000]),
  preset(500000, "₹5,00,000 in hand (gross ₹5,55,787)", [277894, 138947, 5000, 113946, 20000]),
  preset(1000000, "₹10,00,000 in hand (gross ₹11,11,342)", [555671, 277836, 5000, 252835, 20000]),
];
