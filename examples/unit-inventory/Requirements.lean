import Operation

/-- A client requires every accepted reservation to start with nonempty stock. -/
axiom UnitClient.nonempty (stock : UnitInventory.Stock) :
    UnitInventory.NonemptyOnSuccess stock (UnitInventory.POST_units stock)
