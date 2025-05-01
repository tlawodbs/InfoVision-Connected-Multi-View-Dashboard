// dashboard.js

// Shared state across components
const state = { timeRange: null, selectedRows: new Set(), selectedProducts: new Set() };
let updateTimeout;
function scheduleUpdate() { clearTimeout(updateTimeout); updateTimeout = setTimeout(renderAll, 100); }

// Load data and initialize components
d3.csv("chocolate_sales.csv", d => ({
  salesPerson: d["Sales Person"], country: d.Country, product: d.Product,
  date: d3.timeParse("%d-%b-%y")(d.Date),
  amount: +d.Amount.replace(/[$,]/g, ""),
  boxes: +d["Boxes Shipped"]
})).then(data => {
  window.tableData = data;

  // Aggregate monthly totals and cumulative
  const fmt = d3.timeFormat("%Y-%m");
  let cum = 0;
  const monthlyMap = d3.rollups(
    data,
    v => ({ total: d3.sum(v, d => d.amount), byProduct: d3.rollup(v, g => d3.sum(g, d => d.amount), d => d.product) }),
    d => fmt(d.date)
  );
  const monthly = Array.from(monthlyMap, ([m, val]) => {
    const entry = {
      month: d3.timeParse("%Y-%m")(m),
      total: val.total,
      byProduct: val.byProduct
    };
    cum += val.total;
    entry.cumulative = cum;
    return entry;
  }).sort((a, b) => d3.ascending(a.month, b.month));
  window.monthly = monthly;

  // Initialize visualizations
  initAreaChart();
  initBarChart();
  initTable();

  // Reset button handler
  d3.select("#reset-btn").on("click", () => {
    state.timeRange = null;
    state.selectedRows.clear();
    state.selectedProducts.clear();
    // Clear brush selection visually
    d3.select(".brush").call(brush.move, null);
    renderAll();
  });
});

// AREA CHART with brushing and zoom update
let areaSvg, areaX, areaY, areaGen, areaPath, xAxisGroup, brush;
function initAreaChart() {
  const margin = { top: 10, right: 10, bottom: 60, left: 40 };
  const width = 400 - margin.left - margin.right;
  const height = 200 - margin.top - margin.bottom;
  const contextHeight = 80;
  const contextSpacing = 20;

  // SVG container
  areaSvg = d3.select("#area-chart")
    .append("svg")
    .attr("width", width + margin.left + margin.right)
    .attr("height", margin.top + height + margin.bottom + contextSpacing + contextHeight)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Scales
  areaX = d3.scaleTime()
    .domain(d3.extent(window.monthly, d => d.month))
    .range([0, width]);
  areaY = d3.scaleLinear()
    .domain([0, d3.max(window.monthly, d => d.cumulative)])
    .range([height, 0]);
  const xContext = d3.scaleTime().domain(areaX.domain()).range([0, width]);
  const yContext = d3.scaleLinear().domain(areaY.domain()).range([contextHeight, 0]);

  // Area generators
  areaGen = d3.area()
    .x(d => areaX(d.month))
    .y0(height)
    .y1(d => areaY(d.cumulative));
  const areaContextGen = d3.area()
    .x(d => xContext(d.month))
    .y0(contextHeight)
    .y1(d => yContext(d.cumulative));

  // Main area path
  areaPath = areaSvg.append("path")
    .datum(window.monthly)
    .attr("class", "area")
    .attr("d", areaGen);

  // Axes for main chart
  xAxisGroup = areaSvg.append("g")
    .attr("class", "x axis")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(areaX));
  areaSvg.append("g")
    .attr("class", "y axis")
    .call(d3.axisLeft(areaY));

  // Context chart group
  const context = areaSvg.append("g")
    .attr("transform", `translate(0,${height + contextSpacing})`);
  context.append("path")
    .datum(window.monthly)
    .attr("class", "area")
    .attr("d", areaContextGen);
  context.append("g")
    .attr("class", "x axis")
    .attr("transform", `translate(0,${contextHeight})`)
    .call(d3.axisBottom(xContext));

  // Brush setup
  brush = d3.brushX()
    .extent([[0, 0], [width, contextHeight]])
    .on("brush end", ({ selection }) => {
      state.timeRange = selection ? selection.map(xContext.invert) : null;
      scheduleUpdate();
    });

  // Add brush to context
  context.append("g")
    .attr("class", "brush")
    .call(brush);
}

// Update main chart when brush selection changes
function updateAreaChart() {
  if (state.timeRange) {
    areaX.domain(state.timeRange);
  } else {
    areaX.domain(d3.extent(window.monthly, d => d.month));
  }
  // Redraw area path and x-axis with transition
  areaPath.transition().duration(500).attr("d", areaGen);
  xAxisGroup.transition().duration(500).call(d3.axisBottom(areaX));
}

// STACKED BAR CHART
function initBarChart() {
  const svg = d3.select("#bar-chart svg");
  const margin = { top: 20, right: 150, bottom: 80, left: 60 };
  const width = parseInt(svg.style("width")) - margin.left - margin.right;
  const height = parseInt(svg.style("height")) - margin.top - margin.bottom;
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const color = d3.scaleOrdinal(d3.schemeCategory10);
  const tooltip = d3.select("body").append("div").attr("class", "tooltip").style("opacity", 0);

  const allProducts = Array.from(new Set(window.tableData.map(d => d.product)));
  const months = Array.from(new Set(window.monthly.map(d => d3.timeFormat("%Y-%m")(d.month)))).sort();

  // Checkbox filters
  const cb = d3.select(".checkboxes");
  allProducts.forEach(prod => {
    const lbl = cb.append("label");
    lbl.append("span").attr("class", "color-box").style("background-color", color(prod));
    lbl.append("input")
      .attr("type", "checkbox")
      .attr("checked", true)
      .attr("value", prod)
      .on("change", updateBars);
    lbl.append("span").text(` ${prod}`);
  });

  function updateBars() {
    const selected = d3.selectAll(".checkboxes input:checked").nodes().map(n => n.value);
    state.selectedProducts = new Set(selected);

    const monthlyData = months.map(month => {
      const rec = { month };
      selected.forEach(p => {
        rec[p] = d3.sum(
          window.tableData.filter(d => d3.timeFormat("%Y-%m")(d.date) === month && d.product === p),
          d => d.amount
        );
      });
      return rec;
    });

    const stack = d3.stack().keys(selected);
    const sd = stack(monthlyData);

    const x = d3.scaleBand().domain(months).range([0, width]).padding(0.1);
    const maxY = d3.max(sd, series => d3.max(series, d => d[1]));
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([height, 0]);

    g.selectAll(".axis").remove();
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickFormat(d => d3.timeFormat("%b %Y")(new Date(d))))
      .selectAll("text").attr("transform", "rotate(-45)").style("text-anchor", "end");

    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(6).tickFormat(d => `$${d3.format(",")(d)}`));

    const layers = g.selectAll(".layer").data(sd, d => d.key);
    layers.join(
      enter => enter.append("g").attr("class", "layer").attr("fill", d => color(d.key))
        .selectAll("rect").data(d => d.map(p => ({ ...p, key: d.key }))).join("rect")
          .attr("x", d => x(d.data.month)).attr("width", x.bandwidth())
          .attr("y", height).attr("height", 0)
          .on("mouseover", (e, d) => {
            tooltip.transition().duration(200).style("opacity", 0.9);
            tooltip.html(`<strong>${d.key}</strong><br>${d.data.month}<br>Sales: $${(d[1] - d[0]).toLocaleString()}`)
              .style("left", `${e.pageX + 10}px`).style("top", `${e.pageY - 30}px`);
          })
          .on("mouseout", () => tooltip.transition().duration(200).style("opacity", 0))
          .on("click", (e, d) => { state.selectedProducts.has(d.key) ? state.selectedProducts.delete(d.key) : state.selectedProducts.add(d.key); scheduleUpdate(); })
          .transition().duration(800).attr("y", d => y(d[1])).attr("height", d => y(d[0]) - y(d[1])),
      update => update.transition().duration(300)
        .attr("y", d => y(d[1])).attr("height", d => y(d[0]) - y(d[1]))
    );
    layers.exit().remove();
  }

  state.selectedProducts = new Set(allProducts);
  updateBars();
  window.addEventListener("resize", updateBars);
}

// at the top, initialize a filter state object
state.filters = {};  

// DATA TABLE with column filters
function initTable() {
  const container = d3.select("#table-container");
  const table = container.append("table");
  const columns = Object.keys(window.tableData[0]);

  // Initialize filters state
  columns.forEach(col => state.filters[col] = "");

  const thead = table.append("thead");
  // Filter inputs row
  const filterRow = thead.append("tr").attr("class", "filter-row");
  filterRow.selectAll("th")
    .data(columns)
    .enter()
    .append("th")
    .append("input")
      .attr("type", "text")
      .attr("placeholder", d => `Filter ${d}`)
      .on("input", (e, col) => {
        state.filters[col] = e.target.value;
        scheduleUpdate();
      });

  // Header row
  const headerRow = thead.append("tr");
  headerRow.selectAll("th")
    .data(columns)
    .enter()
    .append("th")
    .text(d => d);

  // Create tbody inside table
  table.append("tbody");

  // Initial render
  renderTable();
}

function renderTable() {
  let rows = window.tableData;
  const columns = Object.keys(window.tableData[0]);

  // 1) Time-range filter from brush
  if (state.timeRange) {
    rows = rows.filter(d => d.date >= state.timeRange[0] && d.date <= state.timeRange[1]);
  }
  // 2) Category/product filter
  if (state.selectedProducts.size) {
    rows = rows.filter(d => state.selectedProducts.has(d.product));
  }
  // 3) Text filters per column
  rows = rows.filter(d => {
    return columns.every(col => {
      const filterText = state.filters[col].toLowerCase();
      if (!filterText) return true;
      const val = d[col] instanceof Date
        ? d3.timeFormat("%d-%b-%y")(d[col])
        : String(d[col]);
      return val.toLowerCase().includes(filterText);
    });
  });

  // Bind rows to tbody
  const table = d3.select("#table-container table");
  const tbody = table.select("tbody");
  const tr = tbody.selectAll("tr").data(rows, d => d);

  tr.exit().remove();
  const trEnter = tr.enter()
    .append("tr")
    .on("click", (e, d) => {
      const idx = window.tableData.indexOf(d);
      if (state.selectedRows.has(idx)) state.selectedRows.delete(idx);
      else state.selectedRows.add(idx);
      scheduleUpdate();
    });

  trEnter.merge(tr)
    .classed("selected", d => state.selectedRows.has(window.tableData.indexOf(d)));

  // Cells
  trEnter.merge(tr)
    .selectAll("td")
    .data(d => columns.map(col => d[col]))
    .join("td")
    .text(v => v instanceof Date ? d3.timeFormat("%d-%b-%y")(v) : v);
}

// Unified render call
function renderAll() {
  updateAreaChart();
  // bar chart updates itself via its own handler
  renderTable();
}
