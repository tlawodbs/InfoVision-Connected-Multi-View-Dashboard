// Shared state across components
const state = {
  timeRange: null,
  selectedRows: new Set(),
  selectedProducts: new Set(),
  filters: {}
};
let updateTimeout;
function scheduleUpdate() {
  clearTimeout(updateTimeout);
  updateTimeout = setTimeout(renderAll, 100);
}

// Load data and initialize components
importDataAndInit();

function importDataAndInit() {
  d3.csv("chocolate_sales.csv", d => ({
    salesPerson: d["Sales Person"],
    country: d.Country,
    product: d.Product,
    date: d3.timeParse("%d-%b-%y")(d.Date),
    amount: +d.Amount.replace(/[$,]/g, ""),
    boxes: +d["Boxes Shipped"]
  })).then(data => {
    window.tableData = data;

    // Prepare monthly aggregated data
    const fmt = d3.timeFormat("%Y-%m");
    let cum = 0;
    const monthlyMap = d3.rollups(
      data,
      v => ({
        total: d3.sum(v, d => d.amount),
        byProduct: d3.rollup(v, g => d3.sum(g, d => d.amount), d => d.product)
      }),
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

    // Initialize components
    initAreaChart();
    initBarChart();
    initTable();

    // Reset dashboard
    d3.select("#reset-btn").on("click", () => {
      state.timeRange = null;
      state.selectedRows.clear();
      state.selectedProducts.clear();
      d3.select(".brush").call(brush.move, null);
      renderAll();
    });
  });
}

// AREA CHART with brushing and responsive resizing
let areaSvg, areaX, areaY, areaGen, areaPath, xAxisGroup, brush;
function initAreaChart() {
  const margin = { top: 10, right: 10, bottom: 60, left: 40 };
  const width = 400 - margin.left - margin.right;
  const height = 200 - margin.top - margin.bottom;
  const contextHeight = 80;
  const contextSpacing = 20;

  // Responsive SVG with viewBox
  const rawSvg = d3.select("#area-chart").append("svg")
    .attr("viewBox", `0 0 ${width + margin.left + margin.right} ${margin.top + height + margin.bottom + contextSpacing + contextHeight}`)
    .attr("preserveAspectRatio", "xMinYMin meet")
    .style("width", "100%")
    .style("height", "auto");

  areaSvg = rawSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Define clipPath
  areaSvg.append("defs")
    .append("clipPath")
      .attr("id", "focus-clip")
    .append("rect")
      .attr("width", width)
      .attr("height", height);

  // Focus group with clipping
  const focus = areaSvg.append("g")
    .attr("class", "focus")
    .attr("clip-path", "url(#focus-clip)");

  // Scales
  areaX = d3.scaleTime()
    .domain(d3.extent(window.monthly, d => d.month))
    .range([0, width]);

  areaY = d3.scaleLinear()
    .domain([0, d3.max(window.monthly, d => d.cumulative)])
    .range([height, 0]);

  const xContext = d3.scaleTime()
    .domain(areaX.domain())
    .range([0, width]);

  const yContext = d3.scaleLinear()
    .domain(areaY.domain())
    .range([contextHeight, 0]);

  // Area generators
  areaGen = d3.area()
    .x(d => areaX(d.month))
    .y0(height)
    .y1(d => areaY(d.cumulative));

  const areaContextGen = d3.area()
    .x(d => xContext(d.month))
    .y0(contextHeight)
    .y1(d => yContext(d.cumulative));

  // Draw main area path
  areaPath = focus.append("path")
    .datum(window.monthly)
    .attr("d", areaGen)
    .attr("fill", "lightsteelblue")
    .attr("fill-opacity", 0.6)
    .attr("stroke", "#4682b4")
    .attr("stroke-width", 1);

  // Axes on main chart
  xAxisGroup = areaSvg.append("g")
    .attr("class", "x axis")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(areaX));

  areaSvg.append("g")
    .attr("class", "y axis")
    .call(d3.axisLeft(areaY));

  // Context chart for brushing
  const context = areaSvg.append("g")
    .attr("transform", `translate(0,${height + contextSpacing})`);

  context.append("path")
    .datum(window.monthly)
    .attr("d", areaContextGen)
    .attr("fill", "#d3eaf7")
    .attr("fill-opacity", 0.5)
    .attr("stroke", "none");

  context.append("g")
    .attr("class", "x axis")
    .attr("transform", `translate(0,${contextHeight})`)
    .call(d3.axisBottom(xContext));

  // Brush setup
  brush = d3.brushX()
    .extent([[0, 0], [width, contextHeight]])
    .on("brush end", ({ selection }) => {
      if (selection) {
        const [x0, x1] = selection.map(xContext.invert);
        const full = d3.extent(window.monthly, d => d.month);
        const min = d3.max([x0, full[0]]);
        const max = d3.min([x1, full[1]]);
        state.timeRange = [min, max];
      } else {
        state.timeRange = null;
      }
      scheduleUpdate();
    });

  context.append("g")
    .attr("class", "brush")
    .call(brush);
}

// Update area chart on brush events
function updateAreaChart() {
  const fullDomain = d3.extent(window.monthly, d => d.month);
  if (state.timeRange) {
    areaX.domain(state.timeRange);
  } else {
    areaX.domain(fullDomain);
  }
  areaPath.transition().duration(500).attr("d", areaGen);
  xAxisGroup.transition().duration(500).call(d3.axisBottom(areaX));
}

// STACKED BAR CHART
function initBarChart() {
  const svg = d3.select("#bar-chart svg");
  const margin = { top: 20, right: 150, bottom: 80, left: 60 };

  // 1) SVG DOM 노드에서 실제 픽셀 크기 가져오기
  const svgNode = svg.node();
  const svgWidth  = svgNode.clientWidth;   // CSS에 의해 계산된 실제 넓이(px)
  const svgHeight = svgNode.clientHeight;  // CSS에 의해 계산된 실제 높이(px)

  // 2) 여백(margin)을 뺀 실제 그리기 영역 계산
  const width  = svgWidth  - margin.left - margin.right;
  const height = svgHeight - margin.top  - margin.bottom;

  // 3) 그룹 생성
  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // 이제 width,height가 NaN이 아니므로, 아래 x,y 스케일과 막대 그리기가 정상 동작합니다.
  const color = d3.scaleOrdinal(d3.schemeCategory10);
  const tooltip = d3.select("body")
    .append("div")
    .attr("class", "tooltip")
    .style("opacity", 0);

  const allProducts = Array.from(new Set(window.tableData.map(d => d.product)));
  const months     = Array.from(new Set(window.monthly.map(d => d3.timeFormat("%Y-%m")(d.month)))).sort();

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
      enter => enter.append("g").attr("class","layer").attr("fill", d => color(d.key))
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

// DATA TABLE with filters
function initTable() {
  const container = d3.select("#table-container");
  const table = container.append("table");
  const columns = Object.keys(window.tableData[0]);

  columns.forEach(col => state.filters[col] = "");

  const thead = table.append("thead");
  const filterRow = thead.append("tr").attr("class", "filter-row");
  filterRow.selectAll("th").data(columns).enter().append("th").append("input")
    .attr("type","text").attr("placeholder", d => `Filter ${d}`)
    .on("input", (e, col) => { state.filters[col] = e.target.value; scheduleUpdate(); });

  const headerRow = thead.append("tr");
  headerRow.selectAll("th").data(columns).enter().append("th").text(d => d);
  table.append("tbody");

  renderTable();
}

function renderTable() {
  let rows = window.tableData;
  const columns = Object.keys(window.tableData[0]);

  if (state.timeRange) {
    rows = rows.filter(d => d.date >= state.timeRange[0] && d.date <= state.timeRange[1]);
  }
  if (state.selectedProducts.size) {
    rows = rows.filter(d => state.selectedProducts.has(d.product));
  }
  rows = rows.filter(d => columns.every(col => {
    const text = state.filters[col].toLowerCase();
    if (!text) return true;
    const val = d[col] instanceof Date ? d3.timeFormat("%d-%b-%y")(d[col]) : String(d[col]);
    return val.toLowerCase().includes(text);
  }));

  const tbody = d3.select("#table-container tbody");
  const tr = tbody.selectAll("tr").data(rows, d => d);
  tr.exit().remove();
  const trEnter = tr.enter().append("tr").on("click", (e, d) => {
    const idx = window.tableData.indexOf(d);
    state.selectedRows.has(idx) ? state.selectedRows.delete(idx) : state.selectedRows.add(idx);
    scheduleUpdate();
  });
  trEnter.merge(tr).classed("selected", d => state.selectedRows.has(window.tableData.indexOf(d)));
  trEnter.merge(tr).selectAll("td").data(d => columns.map(col => d[col])).join("td")
    .text(v => v instanceof Date ? d3.timeFormat("%d-%b-%y")(v) : v);
}

function renderAll() {
  updateAreaChart();
  renderTable();
}
