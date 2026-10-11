// Product world for the simulated small autonomous supermarket (Swanston St / Town Hall, Melbourne CBD).
// Generic product names are used deliberately: this is a fictional store, not a real IGA range.
// Prices are indicative A$ CBD convenience-supermarket shelf prices (2026); unit costs give category
// gross margins of roughly 32-60% (dairy and pantry lowest; ready-to-eat, water and convenience accessories highest).
//
// Columns:
//   id, name (includes pack size), category, unitCost, unitPrice,
//   shelfLifeDays (null = non-perishable within the 60-day horizon), caseSize (supplier pack),
//   popularity (relative pick weight within its category, used by the demand model),
//   planDailyUnits (the store planner's pre-opening desk estimate of daily unit sales; used ONLY to
//   size opening inventory and as the Store Brain's initial forecast prior - it is NOT the demand model)

export const CATEGORIES = {
  DRK: 'Drinks',
  SNK: 'Snacks & Confectionery',
  DAI: 'Dairy & Chilled',
  BAK: 'Bakery',
  FRS: 'Fresh Produce',
  RTE: 'Ready-to-Eat',
  PAN: 'Pantry & Grocery',
  HHP: 'Household & Personal Care',
};

// prettier-ignore
const RAW = [
  // id      name                                 cat    cost   price  shelf case pop  plan
  ['DRK01', 'Spring Water 600ml',                 'DRK',  1.00,  2.50, null, 24, 10,  55],
  ['DRK02', 'Sparkling Water 1.25L',              'DRK',  1.56,  3.00, null, 12,  3,  15],
  ['DRK03', 'Cola 600ml',                         'DRK',  2.18,  4.20, null, 24,  7,  40],
  ['DRK04', 'Cola No Sugar 600ml',                'DRK',  2.18,  4.20, null, 24,  6,  32],
  ['DRK05', 'Energy Drink 500ml',                 'DRK',  2.50,  4.80, null, 24,  5,  24],
  ['DRK06', 'Iced Coffee Milk 500ml',             'DRK',  2.34,  4.50,   12, 12,  6,  30],
  ['DRK07', 'Orange Juice 1L',                    'DRK',  2.86,  5.50,   10,  6,  3,  15],
  ['DRK08', 'Kombucha 330ml',                     'DRK',  2.60,  5.00, null, 12,  2,  16],
  ['DRK09', 'Sports Drink 600ml',                 'DRK',  2.08,  4.00, null, 24,  3,  16],
  ['DRK10', 'Iced Tea 500ml',                     'DRK',  1.98,  3.80, null, 24,  3,  15],

  ['SNK01', 'Potato Chips 175g',                  'SNK',  2.69,  4.80, null, 12,  6,  22],
  ['SNK02', 'Chocolate Bar 50g',                  'SNK',  1.57,  2.80, null, 48,  9,  34],
  ['SNK03', 'Chocolate Block 180g',               'SNK',  3.36,  6.00, null, 16,  3,  10],
  ['SNK04', 'Muesli Bars 6pk',                    'SNK',  2.52,  4.50, null, 12,  3,  11],
  ['SNK05', 'Mixed Nuts 150g',                    'SNK',  3.64,  6.50, null, 12,  2,   8],
  ['SNK06', 'Gummy Lollies 200g',                 'SNK',  2.24,  4.00, null, 12,  3,  10],
  ['SNK07', 'Protein Bar 60g',                    'SNK',  2.52,  4.50, null, 24,  3,  12],
  ['SNK08', 'Corn Chips 230g',                    'SNK',  2.52,  4.50, null, 12,  2,   7],
  ['SNK09', 'Rice Crackers 100g',                 'SNK',  1.79,  3.20, null, 12,  2,   7],

  ['DAI01', 'Full Cream Milk 2L',                 'DAI',  2.45,  3.60,   10,  9,  8,  20],
  ['DAI02', 'Full Cream Milk 1L',                 'DAI',  1.63,  2.40,   10, 12,  6,  16],
  ['DAI03', 'Lite Milk 1L',                       'DAI',  1.63,  2.40,   10, 12,  3,   8],
  ['DAI04', 'Oat Milk UHT 1L',                    'DAI',  2.65,  3.90, null,  8,  3,   7],
  ['DAI05', 'Greek Yoghurt 500g',                 'DAI',  3.74,  5.50,   14,  6,  3,   7],
  ['DAI06', 'Yoghurt Cup 170g',                   'DAI',  1.50,  2.20,   14, 12,  4,   10],
  ['DAI07', 'Cheddar Cheese Block 500g',          'DAI',  5.78,  8.50,   30, 10,  2,   5],
  ['DAI08', 'Butter 250g',                        'DAI',  3.54,  5.20,   45, 12,  2,   5],
  ['DAI09', 'Free Range Eggs 12pk',               'DAI',  5.10,  7.50,   21, 12,  4,   10],
  ['DAI10', 'Sliced Ham 200g',                    'DAI',  4.08,  6.00,    7, 10,  2,   6],

  ['BAK01', 'White Sandwich Loaf 650g',           'BAK',  2.20,  4.00,    4, 10,  5,  26],
  ['BAK02', 'Wholemeal Loaf 650g',                'BAK',  2.31,  4.20,    4, 10,  3,   15],
  ['BAK03', 'Sourdough Loaf 700g',                'BAK',  3.85,  7.00,    3,  6,  2,   18],
  ['BAK04', 'Croissants 2pk',                     'BAK',  2.48,  4.50,    2, 12,  4,  24],
  ['BAK05', 'Banana Bread Slice',                 'BAK',  2.31,  4.20,    3, 12,  3,  16],
  ['BAK06', 'Tortilla Wraps 8pk',                 'BAK',  2.48,  4.50,   14,  8,  2,   10],

  ['FRS01', 'Bananas (each)',                     'FRS',  0.44,  0.75,    5, 50,  6,  55],
  ['FRS02', 'Pink Lady Apple (each)',             'FRS',  0.70,  1.20,   14, 40,  4,  40],
  ['FRS03', 'Salad Leaf Mix 120g',                'FRS',  2.32,  4.00,    5, 10,  3,   15],
  ['FRS04', 'Cherry Tomatoes 250g',               'FRS',  2.61,  4.50,    7, 10,  2,   10],
  ['FRS05', 'Avocado (each)',                     'FRS',  1.45,  2.50,    4, 20,  3,  30],
  ['FRS06', 'Cut Fruit Cup 300g',                 'FRS',  3.19,  5.50,    3,  8,  3,  18],
  ['FRS07', 'Brown Onions 1kg',                   'FRS',  2.03,  3.50,   30, 10,  1,   5],
  ['FRS08', 'Washed Potatoes 2kg',                'FRS',  2.90,  5.00,   21,  8,  1,   5],

  ['RTE01', 'Ham & Cheese Sandwich',              'RTE',  3.98,  7.50,    2,  8,  7,  48],
  ['RTE02', 'Chicken Salad Wrap',                 'RTE',  4.51,  8.50,    2,  8,  6,  40],
  ['RTE03', 'Sushi Roll Pack 6pc',                'RTE',  5.04,  9.50,    1,  8,  5,  45],
  ['RTE04', 'Chicken Caesar Salad Bowl',          'RTE',  5.57, 10.50,    2,  6,  4,  28],
  ['RTE05', 'Microwave Pasta Meal 400g',          'RTE',  5.30, 10.00,    5,  6,  4,  24],
  ['RTE06', 'Butter Chicken & Rice Meal 400g',    'RTE',  5.57, 10.50,    5,  6,  4,  24],
  ['RTE07', 'Fruit & Yoghurt Pot 200g',           'RTE',  2.39,  4.50,    4,  8,  3,  20],
  ['RTE08', 'Sausage Roll (heat & eat)',          'RTE',  2.12,  4.00,    3, 12,  3,  20],

  ['PAN01', 'Spaghetti 500g',                     'PAN',  1.43,  2.20, null, 20,  4,   10],
  ['PAN02', 'Pasta Sauce 500g',                   'PAN',  2.73,  4.20, null, 12,  4,   10],
  ['PAN03', 'Instant Noodles 5pk',                'PAN',  3.12,  4.80, null, 12,  5,  12],
  ['PAN04', 'Basmati Rice 1kg',                   'PAN',  2.93,  4.50, null, 10,  2,   5],
  ['PAN05', 'Tuna in Oil 95g',                    'PAN',  1.69,  2.60, null, 24,  3,   16],
  ['PAN06', 'Diced Tomatoes 400g',                'PAN',  1.24,  1.90, null, 24,  2,   11],
  ['PAN07', 'Breakfast Cereal 500g',              'PAN',  4.23,  6.50, null, 10,  2,   5],
  ['PAN08', 'Peanut Butter 375g',                 'PAN',  3.38,  5.20, null, 12,  1,   3],
  ['PAN09', 'Instant Coffee 100g',                'PAN',  6.18,  9.50, null, 12,  1,   3],
  ['PAN10', 'Black Tea Bags 100pk',               'PAN',  3.90,  6.00, null, 12,  1,   3],
  ['PAN11', 'Extra Virgin Olive Oil 750ml',       'PAN',  7.80, 12.00, null,  6,  1,   6],

  ['HHP01', 'Toilet Paper 6pk',                   'HHP',  4.28,  7.50, null,  8,  4,   6],
  ['HHP02', 'Paper Towel 2pk',                    'HHP',  2.74,  4.80, null, 12,  2,   3],
  ['HHP03', 'Dishwashing Liquid 500ml',           'HHP',  2.17,  3.80, null, 12,  2,   3],
  ['HHP04', 'Laundry Liquid 1L',                  'HHP',  6.84, 12.00, null,  6,  1,   3],
  ['HHP05', 'Toothpaste 110g',                    'HHP',  2.57,  4.50, null, 12,  2,   3],
  ['HHP06', 'Shampoo 400ml',                      'HHP',  4.56,  8.00, null,  6,  1,   2],
  ['HHP07', 'Paracetamol Tablets 20pk',           'HHP',  2.57,  4.50, null, 24,  3,   4],
  ['HHP08', 'Hand Sanitiser 250ml',               'HHP',  2.85,  5.00, null, 12,  1,   2],
  ['HHP09', 'USB-C Charging Cable 1m',            'HHP',  6.00, 15.00, null, 10,  0.6,   4],
  ['HHP10', 'Compact Umbrella',                   'HHP',  7.56, 18.00, null, 10,  0.5,   4],
];

// Products sold "each" where a customer commonly takes several units in one line.
const MULTI_UNIT = new Set(['FRS01', 'FRS02', 'FRS05', 'PAN05', 'PAN06']);

export const CATALOGUE = RAW.map(([id, name, cat, cost, price, shelf, caseSize, pop, plan]) => ({
  product_id: id,
  name,
  category: CATEGORIES[cat],
  category_code: cat,
  unit_cost: cost,
  unit_price: price,
  perishable: shelf != null,
  shelf_life_days: shelf,
  case_size: caseSize,
  popularity: pop,
  plan_daily_units: plan,
  multi_unit: MULTI_UNIT.has(id),
}));
