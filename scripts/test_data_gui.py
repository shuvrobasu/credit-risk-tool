import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import pandas as pd
import os
from sqlalchemy import create_engine
from datetime import datetime
import random

class DataGenApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Credit Tool - Integrated Data Creator & Previewer")
        self.root.geometry("1000x800")
        
        # DB Config (matching .env)
        self.db_url = "postgresql://credit_user:credit_pass_local@localhost:5432/credit_tool"
        self.current_df = None
        
        self.setup_ui()
        
    def setup_ui(self):
        style = ttk.Style()
        style.theme_use('clam')
        style.configure("TButton", font=("Segoe UI", 9), padding=5)
        style.configure("TLabel", font=("Segoe UI", 9))
        style.configure("Header.TLabel", font=("Segoe UI", 12, "bold"))
        
        main = ttk.Frame(self.root, padding="20")
        main.pack(fill=tk.BOTH, expand=True)
        
        # --- Top Control Panel ---
        ctrl_panel = ttk.Frame(main)
        ctrl_panel.pack(fill=tk.X, pady=(0, 20))
        
        # Export Actions
        export_frame = ttk.LabelFrame(ctrl_panel, text=" 1. Fetch live and preview ", padding="15")
        export_frame.pack(side=tk.LEFT, fill=tk.Y, padx=(0, 10))
        
        ttk.Button(export_frame, text="View/Export Invoices", command=lambda: self.load_data("invoices")).pack(side=tk.LEFT, padx=5)
        ttk.Button(export_frame, text="View/Export Customers", command=lambda: self.load_data("customers")).pack(side=tk.LEFT, padx=5)
        
        # Simulation Actions
        sim_frame = ttk.LabelFrame(ctrl_panel, text=" 2. Simulation Logic (Invoices Only) ", padding="15")
        sim_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        opts_sub = ttk.Frame(sim_frame)
        opts_sub.pack(fill=tk.X)
        
        ttk.Label(opts_sub, text="Paid (%):").pack(side=tk.LEFT, padx=5)
        self.paid_pct = tk.IntVar(value=20)
        ttk.Entry(opts_sub, textvariable=self.paid_pct, width=5).pack(side=tk.LEFT)
        
        ttk.Label(opts_sub, text="Part-Paid (%):").pack(side=tk.LEFT, padx=10)
        self.part_pct = tk.IntVar(value=10)
        ttk.Entry(opts_sub, textvariable=self.part_pct, width=5).pack(side=tk.LEFT)
        
        ttk.Label(opts_sub, text="Dispute (%):").pack(side=tk.LEFT, padx=10)
        self.dispute_pct = tk.IntVar(value=5)
        ttk.Entry(opts_sub, textvariable=self.dispute_pct, width=5).pack(side=tk.LEFT)
        
        ttk.Button(sim_frame, text="Run Simulation on Current Preview", command=self.generate_simulation).pack(side=tk.RIGHT, padx=5)
        ttk.Button(sim_frame, text="Load External CSV", command=self.browse_file).pack(side=tk.RIGHT, padx=5)

        # --- Middle: Data Preview (Treeview) ---
        preview_frame = ttk.LabelFrame(main, text=" Data Inspection Table ", padding="10")
        preview_frame.pack(fill=tk.BOTH, expand=True)
        
        # Scrollbars
        self.tree_scroll_y = ttk.Scrollbar(preview_frame)
        self.tree_scroll_y.pack(side=tk.RIGHT, fill=tk.Y)
        
        self.tree_scroll_x = ttk.Scrollbar(preview_frame, orient="horizontal")
        self.tree_scroll_x.pack(side=tk.BOTTOM, fill=tk.X)
        
        self.tree = ttk.Treeview(preview_frame, 
                                yscrollcommand=self.tree_scroll_y.set, 
                                xscrollcommand=self.tree_scroll_x.set, 
                                selectmode="extended")
        self.tree.pack(fill=tk.BOTH, expand=True)
        
        self.tree_scroll_y.config(command=self.tree.yview)
        self.tree_scroll_x.config(command=self.tree.xview)
        
        # --- Bottom: Save/Status ---
        bottom_panel = ttk.Frame(main)
        bottom_panel.pack(fill=tk.X, pady=(20, 0))
        
        ttk.Button(bottom_panel, text="Save Preview to CSV (for Import)", command=self.save_to_csv).pack(side=tk.RIGHT, padx=5)
        
        self.status = tk.StringVar(value="Status: Awaiting action...")
        ttk.Label(bottom_panel, textvariable=self.status, foreground="#666").pack(side=tk.LEFT)

    def update_treeview(self):
        if self.current_df is None: return
        
        # Clear existing
        self.tree.delete(*self.tree.get_children())
        
        # Set columns
        self.tree["columns"] = list(self.current_df.columns)
        self.tree["show"] = "headings"
        
        for col in self.current_df.columns:
            self.tree.heading(col, text=col)
            # Adjust width based on header length or a default
            width = max(len(col) * 10, 100)
            self.tree.column(col, width=width, anchor=tk.W)
            
        # Add data (limit to 1000 for performance if needed, but here simple)
        for _, row in self.current_df.iterrows():
            self.tree.insert("", tk.END, values=list(row))
            
        self.status.set(f"Status: Displaying {len(self.current_df)} records.")

    def load_data(self, table):
        try:
            self.status.set(f"Status: Fetching {table} from DB...")
            engine = create_engine(self.db_url)
            df = pd.read_sql(f"SELECT * FROM {table}", engine)
            
            # Simple cleanup
            for col in ['created_at', 'updated_at']:
                if col in df.columns: df.drop(columns=[col], inplace=True)
                
            self.current_df = df
            self.update_treeview()
        except Exception as e:
            messagebox.showerror("DB Error", str(e))
            self.status.set("Status: Error fetching data.")

    def browse_file(self):
        f = filedialog.askopenfilename(filetypes=[("CSV Files", "*.csv")])
        if f:
            try:
                self.current_df = pd.read_csv(f)
                self.update_treeview()
                self.status.set(f"Status: Loaded file {os.path.basename(f)}")
            except Exception as e:
                messagebox.showerror("Load Error", str(e))

    def generate_simulation(self):
        if self.current_df is None:
            messagebox.showwarning("Warning", "First load data from DB or CSV.")
            return
            
        df = self.current_df.copy()
        if 'status' not in df.columns:
            messagebox.showerror("Error", "No 'status' column found. Simulation requires Invoice data.")
            return
            
        try:
            # Only affect open/partial ones
            open_mask = df['status'].isin(['open', 'partial'])
            open_indices = df[open_mask].index.tolist()
            random.shuffle(open_indices)
            
            total_open = len(open_indices)
            num_paid = int(total_open * (self.paid_pct.get() / 100))
            num_part = int(total_open * (self.part_pct.get() / 100))
            num_disp = int(total_open * (self.dispute_pct.get() / 100))
            
            # 1. Paid
            for _ in range(num_paid):
                if not open_indices: break
                idx = open_indices.pop()
                df.at[idx, 'status'] = 'paid'
                df.at[idx, 'outstanding_amount'] = 0
                
            # 2. Partial
            for _ in range(num_part):
                if not open_indices: break
                idx = open_indices.pop()
                df.at[idx, 'status'] = 'partial'
                curr = float(df.at[idx, 'outstanding_amount'])
                df.at[idx, 'outstanding_amount'] = round(curr * random.uniform(0.3, 0.6), 2)
                
            # 3. Dispute
            for _ in range(num_disp):
                if not open_indices: break
                idx = open_indices.pop()
                df.at[idx, 'status'] = 'disputed'
                # Disputed items usually keep their amount but are blocked from dunning
            
            self.current_df = df
            self.update_treeview()
            messagebox.showinfo("Simulation Run", 
                f"Simulation results applied to preview:\n"
                f"- {num_paid} marked as PAID\n"
                f"- {num_part} marked as PARTIAL\n"
                f"- {num_disp} marked as DISPUTED\n\n"
                f"Review the table and save to CSV when ready.")
            self.status.set(f"Status: Simulation applied. {num_paid} paid, {num_part} partial, {num_disp} disputed.")
        except Exception as e:
            messagebox.showerror("Simulation Error", str(e))

    def save_to_csv(self):
        if self.current_df is None:
            messagebox.showwarning("Warning", "Nothing to save. Load data first.")
            return
            
        filename = f"sim_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        try:
            self.current_df.to_csv(filename, index=False)
            messagebox.showinfo("Export Successful", f"Saved as: {filename}\n\nYou can now use this file in the Import Mapping tool.")
            self.status.set(f"Status: Saved to {filename}")
        except Exception as e:
            messagebox.showerror("Save Error", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    app = DataGenApp(root)
    root.mainloop()
