export type Category = 'income' | 'savings' | 'bills' | 'household' | 'debt'
export type Frequency = 'monthly' | 'yearly'

export interface BudgetItem {
  id: string
  name: string
  category: Category
  amount: number
  frequency: Frequency
  due_day: number | null
  due_month: number | null
  debt_id: string | null
  savings_goal_id: string | null
  effective_from: string
  effective_to: string | null
  created_at: string
}

export interface Transaction {
  id: string
  /** pencatat (anggota household) */
  user_id: string | null
  date: string
  amount: number
  category: Category
  budget_item_id: string | null
  debt_id: string | null
  savings_goal_id: string | null
  note: string | null
  /** asal pencatatan */
  source?: 'app' | 'telegram'
  created_at: string
}

export interface Debt {
  id: string
  name: string
  principal: number
  monthly_installment: number
  interest_rate_monthly: number | null
  due_day: number | null
  start_date: string | null
  tenor_months: number | null
  status: 'active' | 'archived'
  created_at: string
}

export interface SavingsGoal {
  id: string
  name: string
  target_amount: number
  initial_amount: number
  monthly_plan: number
  target_date: string | null
  created_at: string
}

export interface MonthSetting {
  year: number
  month: number
  carry_over: boolean
}

export interface MonthlyActual {
  year: number
  month: number
  category: Category
  total: number
}

export interface DebtPaid {
  debt_id: string
  paid: number
  payments: number
  last_paid: string | null
}

export interface SavingsPaid {
  savings_goal_id: string
  paid: number
}

export interface AnnualGoal {
  id: string
  year: number
  title: string
  is_done: boolean
  created_at: string
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
}

export interface HouseholdMember {
  user_id: string
  role: 'owner' | 'member'
  profile: Profile | null
}

export interface HouseholdInvite {
  email: string
  created_at: string
}

export interface Household {
  id: string
  name: string
  notify_threshold: number
  reminders_enabled: boolean
  budget_alerts_enabled: boolean
  summaries_enabled: boolean
  members: HouseholdMember[]
  invites: HouseholdInvite[]
}

export interface TelegramAccount {
  user_id: string
  username: string | null
  first_name: string | null
  linked_at: string
}

export interface TelegramGroup {
  chat_id: number
  title: string | null
  linked_at: string
}
